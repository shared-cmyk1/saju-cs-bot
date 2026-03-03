import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from './graphApi';
import * as templates from './messageTemplates';
import { matchRule, generateAutoResponse } from '@/app/lib/ai/learningService';
import {
  postEscalation,
  postFollowUpMessage,
  postResponseProposal,
} from '@/app/lib/slack/slackClient';
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
    const messageMid = event.message?.mid;

    // 1. 비텍스트 메시지 → 무시
    if (!messageText) return;

    // 2. 중복 메시지 체크 (Instagram 웹훅 재전송 방지)
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

    // 3. 대화 생성/조회 + 메시지 저장
    const conversation = await this.getOrCreateConversation(instagramUserId);
    const nextIndex = await this.getNextMessageIndex(conversation.id);

    await supabase.from('saju_cs_messages').insert({
      conversation_id: conversation.id,
      message_index: nextIndex,
      role: 'user',
      content: messageText,
      source: 'user',
      instagram_mid: messageMid,
    });

    // 4. 이미 에스컬레이션 대기 중이면 Slack에 추가 메시지만 전달
    const { data: pendingEscalation } = await supabase
      .from('saju_cs_escalations')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingEscalation) {
      await postFollowUpMessage({
        username: conversation.instagram_username,
        userQuestion: messageText,
      });
    } else {
      // 5. 승인된 자동 규칙 매칭 시도
      const match = await matchRule(messageText);

      if (match) {
        // 규칙 매칭 → Slack에 자동 응답 제안 (보내기/거절 버튼)
        const proposedResponse = await generateAutoResponse(match.rule, messageText);

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
          const { channelId, messageTs } = await postResponseProposal({
            pendingResponseId: pending.id,
            username: conversation.instagram_username,
            customerMessage: messageText,
            proposedResponse,
            category: match.rule.category,
          });

          await supabase
            .from('saju_cs_pending_responses')
            .update({
              slack_message_ts: messageTs,
              slack_channel_id: channelId,
            })
            .eq('id', pending.id);
        }
      } else {
        // 6. 매칭 없음 → Slack에 에스컬레이션
        await postEscalation({
          conversationId: conversation.id,
          instagramUserId,
          username: conversation.instagram_username,
          userQuestion: messageText,
        });
      }
    }

    // 7. 업무 외 시간 → 안내 메시지 전송 (하루 1회)
    if (!isBusinessHours()) {
      const now = new Date();
      const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      const todayKST = kst.toISOString().slice(0, 10); // YYYY-MM-DD in KST
      const todayStartUTC = new Date(`${todayKST}T00:00:00+09:00`).toISOString();

      const { count } = await supabase
        .from('saju_cs_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversation.id)
        .eq('source', 'system')
        .gte('created_at', todayStartUTC);

      const alreadyNotifiedToday = (count ?? 0) > 0;

      if (!alreadyNotifiedToday) {
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
