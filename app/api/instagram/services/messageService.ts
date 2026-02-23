import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from './graphApi';
import * as templates from './messageTemplates';
import { matchRule, generateAutoResponse } from '@/app/lib/ai/learningService';
import { postResponseProposal } from '@/app/lib/slack/slackClient';
import type { InstagramMessageEvent, Conversation } from '@/app/lib/types';

function isBusinessHours(): boolean {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay(); // 0=Sun, 6=Sat
  const hour = kst.getUTCHours();
  return day >= 1 && day <= 5 && hour >= 10 && hour < 19;
}

export const messageService = {
  async handleMessage(event: InstagramMessageEvent): Promise<void> {
    const instagramUserId = event.sender.id;
    const messageText = event.message?.text;

    // 1. 비텍스트 메시지 → 무시
    if (!messageText) return;

    // 2. 대화 생성/조회 + 메시지 저장
    const conversation = await this.getOrCreateConversation(instagramUserId);
    const nextIndex = await this.getNextMessageIndex(conversation.id);
    const isFirstMessage = nextIndex === 0;

    await supabase.from('saju_cs_messages').insert({
      conversation_id: conversation.id,
      message_index: nextIndex,
      role: 'user',
      content: messageText,
      source: 'user',
      instagram_mid: event.message?.mid,
    });

    if (isBusinessHours()) {
      // 3. 업무시간 + 승인된 규칙 매칭 → Slack에 응답 초안 제안
      const match = await matchRule(messageText);
      if (match) {
        const proposedResponse = await generateAutoResponse(match.rule, messageText);

        // DB에 pending response 생성
        const { data: pending, error } = await supabase
          .from('saju_cs_pending_responses')
          .insert({
            rule_id: match.rule.id,
            conversation_id: conversation.id,
            instagram_user_id: instagramUserId,
            customer_message: messageText,
            proposed_response: proposedResponse,
            status: 'pending',
          })
          .select('id')
          .single();

        if (!error && pending) {
          // Slack에 건별 응답 제안
          const { channelId, messageTs } = await postResponseProposal({
            pendingResponseId: pending.id,
            username: conversation.instagram_username,
            customerMessage: messageText,
            proposedResponse,
            category: match.rule.category,
          });

          // Slack 메시지 정보 저장
          await supabase
            .from('saju_cs_pending_responses')
            .update({
              slack_message_ts: messageTs,
              slack_channel_id: channelId,
            })
            .eq('id', pending.id);
        }
      }
      // 4. 업무시간 + 매칭 없음 → return (담당자가 처리)
    } else {
      // 5. 업무 외 → 마지막 응답이 이미 안내 메시지가 아닐 때만 전송
      const { data: lastAssistantMsg } = await supabase
        .from('saju_cs_messages')
        .select('source')
        .eq('conversation_id', conversation.id)
        .eq('role', 'assistant')
        .order('message_index', { ascending: false })
        .limit(1)
        .maybeSingle();

      const alreadyNotified = lastAssistantMsg?.source === 'system';

      if (!alreadyNotified) {
        const offHoursMsg = templates.getOffHoursMessage();
        await graphApi.sendMessage(instagramUserId, offHoursMsg);
        await supabase.from('saju_cs_messages').insert({
          conversation_id: conversation.id,
          message_index: nextIndex + 1,
          role: 'assistant',
          content: offHoursMsg,
          source: 'system',
        });
      }
    }

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
