import type { InstagramWebhookBody, InstagramMessageEvent } from '@/app/lib/types';
import { messageService } from './messageService';
import { supabase } from '@/app/lib/supabase/client';
import { updateEscalationMessage } from '@/app/lib/slack/slackClient';

export const webhookHandler = {
  async handle(body: InstagramWebhookBody): Promise<void> {
    const businessAccountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    for (const entry of body.entry) {
      if (!entry.messaging) continue;

      for (const event of entry.messaging) {
        // 비즈니스 계정이 보낸 메시지 → DM으로 직접 답변한 경우
        if (event.sender.id === businessAccountId) {
          if (event.message?.text) {
            await this.handleBusinessReply(event);
          }
          continue;
        }

        // 고객 메시지 처리
        if (event.message) {
          await this.handleMessage(event);
        }
      }
    }
  },

  // 비즈니스 계정이 DM으로 직접 답변 → pending 에스컬레이션 자동 완료
  async handleBusinessReply(event: InstagramMessageEvent): Promise<void> {
    try {
      const recipientId = event.recipient.id;

      // 해당 고객의 대화 찾기
      const { data: conversation } = await supabase
        .from('saju_cs_conversations')
        .select('id')
        .eq('instagram_user_id', recipientId)
        .maybeSingle();

      if (!conversation) return;

      // pending 에스컬레이션 찾기
      const { data: escalation } = await supabase
        .from('saju_cs_escalations')
        .select('id, slack_channel_id, slack_message_ts, conversation_id')
        .eq('conversation_id', conversation.id)
        .eq('status', 'pending')
        .maybeSingle();

      if (!escalation) return;

      // 에스컬레이션에 연결된 원래 질문 가져오기
      const { data: userMsg } = await supabase
        .from('saju_cs_messages')
        .select('content')
        .eq('conversation_id', conversation.id)
        .eq('role', 'user')
        .order('message_index', { ascending: false })
        .limit(1)
        .single();

      // DB 업데이트: 답변 완료
      await supabase
        .from('saju_cs_escalations')
        .update({
          status: 'answered',
          team_response: event.message?.text,
          responded_by: 'instagram_dm',
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', escalation.id);

      // Slack 메시지 업데이트
      await updateEscalationMessage(
        escalation.slack_channel_id,
        escalation.slack_message_ts,
        'Instagram DM',
        userMsg?.content || '(질문 없음)'
      );

      console.log('[WebhookHandler] Business reply resolved escalation:', escalation.id);
    } catch (error) {
      console.error('[WebhookHandler] Business reply handling error:', error);
    }
  },

  async handleMessage(event: InstagramMessageEvent): Promise<void> {
    try {
      await messageService.handleMessage(event);
    } catch (error) {
      console.error('[WebhookHandler] Message handling error:', {
        senderId: event.sender.id,
        error,
      });
    }
  },
};
