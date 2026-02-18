import { supabase } from '@/app/lib/supabase/client';
import { loadFAQ } from '@/app/lib/faq/loader';
import { generateResponse } from '@/app/lib/ai/csBot';
import { postEscalation, postFollowUpMessage } from '@/app/lib/slack/slackClient';
import * as graphApi from './graphApi';
import * as templates from './messageTemplates';
import type { InstagramMessageEvent, Conversation, Message } from '@/app/lib/types';

export const messageService = {
  async handleMessage(event: InstagramMessageEvent): Promise<void> {
    const instagramUserId = event.sender.id;
    const messageText = event.message?.text;
    const messageMid = event.message?.mid;

    // 비텍스트 메시지 처리 (이미지, 스티커 등)
    if (!messageText) {
      if (event.message?.attachments) {
        await graphApi.sendMessage(instagramUserId, templates.getNonTextMessage());
      }
      return;
    }

    // 중복 메시지 체크
    if (messageMid) {
      const { data: existing } = await supabase
        .from('saju_cs_messages')
        .select('id')
        .eq('instagram_mid', messageMid)
        .maybeSingle();

      if (existing) {
        console.log('[MessageService] Duplicate message, skipping:', messageMid);
        return;
      }
    }

    // 1. 대화 가져오기 또는 생성
    const conversation = await this.getOrCreateConversation(instagramUserId);

    // 2. 진행 중인 에스컬레이션 확인
    const { data: pendingEscalation } = await supabase
      .from('saju_cs_escalations')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('status', 'pending')
      .maybeSingle();

    // 3. 사용자 메시지 저장
    const nextIndex = await this.getNextMessageIndex(conversation.id);
    const isFirstMessage = nextIndex === 0;
    const { data: savedMessage, error: saveError } = await supabase
      .from('saju_cs_messages')
      .insert({
        conversation_id: conversation.id,
        message_index: nextIndex,
        role: 'user',
        content: messageText,
        source: 'user',
        instagram_mid: messageMid,
      })
      .select('id')
      .single();

    if (saveError) {
      console.error('[MessageService] Failed to save user message:', saveError);
    }

    // 이미 에스컬레이션 대기 중이면 유저에게 답장 없이 Slack에만 전달
    if (pendingEscalation) {
      await postFollowUpMessage({
        username: conversation.instagram_username,
        userQuestion: messageText,
      });
      return;
    }

    // 4. 대화 이력 로드 (최근 20개)
    const history = await this.getRecentMessages(conversation.id, 20);

    // 5. FAQ 로드
    const faqContent = loadFAQ();

    // 6. AI 응답 생성
    const aiResult = await generateResponse({
      faqContent,
      conversationHistory: history.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      currentMessage: messageText,
      username: conversation.instagram_username || undefined,
    });

    // 7. 응답 분기
    if (aiResult.shouldEscalate) {
      // 첫 번째 DM에만 인사 메시지 전송
      if (isFirstMessage) {
        await graphApi.sendMessage(instagramUserId, templates.getHoldingMessage());

        await supabase.from('saju_cs_messages').insert({
          conversation_id: conversation.id,
          message_index: nextIndex + 1,
          role: 'assistant',
          content: templates.getHoldingMessage(),
          source: 'ai',
        });
      }

      // Slack 에스컬레이션
      if (!savedMessage) {
        console.error('[MessageService] savedMessage is null, skipping escalation');
      }
      try {
        await postEscalation({
          escalationId: '',
          conversationId: conversation.id,
          instagramUserId,
          username: conversation.instagram_username,
          userQuestion: messageText,
          aiSuggestedAnswer: aiResult.suggestedAnswer,
        });
        console.log('[MessageService] Slack escalation posted successfully');
      } catch (slackError) {
        console.error('[MessageService] Slack escalation failed:', slackError);
      }

      console.log('[MessageService] Escalated:', {
        user: conversation.instagram_username,
        question: messageText,
        reasoning: aiResult.reasoning,
      });
    } else {
      // AI 답변 직접 전송
      await graphApi.sendMessage(instagramUserId, aiResult.answer);

      // 답변 DB 저장
      await supabase.from('saju_cs_messages').insert({
        conversation_id: conversation.id,
        message_index: nextIndex + 1,
        role: 'assistant',
        content: aiResult.answer,
        source: 'ai',
      });

      console.log('[MessageService] Auto-responded:', {
        user: conversation.instagram_username,
        matchedFAQ: aiResult.matchedFAQ,
      });
    }

    // 대화 updated_at 갱신
    await supabase
      .from('saju_cs_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', conversation.id);
  },

  async getOrCreateConversation(instagramUserId: string): Promise<Conversation> {
    const { data: existing } = await supabase
      .from('saju_cs_conversations')
      .select('*')
      .eq('instagram_user_id', instagramUserId)
      .maybeSingle();

    if (existing) return existing as Conversation;

    const userInfo = await graphApi.getUserInfo(instagramUserId);

    const { data: created, error } = await supabase
      .from('saju_cs_conversations')
      .insert({
        instagram_user_id: instagramUserId,
        instagram_username: userInfo.username || null,
      })
      .select('*')
      .single();

    if (error) throw new Error(`Failed to create conversation: ${error.message}`);
    return created as Conversation;
  },

  async getRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
    const { data } = await supabase
      .from('saju_cs_messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('message_index', { ascending: true })
      .limit(limit);

    return (data || []) as Message[];
  },

  async getNextMessageIndex(conversationId: string): Promise<number> {
    const { data } = await supabase
      .from('saju_cs_messages')
      .select('message_index')
      .eq('conversation_id', conversationId)
      .order('message_index', { ascending: false })
      .limit(1);

    if (data && data.length > 0) {
      return data[0].message_index + 1;
    }
    return 0;
  },
};
