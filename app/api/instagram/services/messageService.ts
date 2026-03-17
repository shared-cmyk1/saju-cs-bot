import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from './graphApi';
import * as templates from './messageTemplates';
import { matchRule, generateAutoResponse } from '@/app/lib/ai/learningService';
import {
  postEscalation,
  postFollowUpMessage,
  postResponseProposal,
} from '@/app/lib/slack/slackClient';
import {
  getActiveSession,
  handleSessionMessage,
  tryAutoSessionFromWinnerDM,
  createSession,
  mapServiceToGoodsType,
  extractPersonInfo,
  formatConfirmation,
  MESSAGES,
} from '@/app/lib/report/reportService';
import type { InstagramMessageEvent, Conversation, AccountConfig } from '@/app/lib/types';

function isBusinessHours(account: AccountConfig): boolean {
  const tz = account.business_hours_timezone || 'Asia/Seoul';
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
  });
  const parts = formatter.formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value || '0');
  const weekdayStr = parts.find((p) => p.type === 'weekday')?.value || '';
  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const day = dayMap[weekdayStr] ?? 0;
  const businessDays = account.business_days || [1, 2, 3, 4, 5];
  return (
    businessDays.includes(day) &&
    hour >= account.business_hours_start &&
    hour < account.business_hours_end
  );
}

export const messageService = {
  async handleMessage(event: InstagramMessageEvent, account: AccountConfig): Promise<void> {
    const instagramUserId = event.sender.id;
    const messageText = event.message?.text;
    const messageMid = event.message?.mid;
    const attachments = event.message?.attachments;
    const hasImage = attachments?.some((a) => a.type === 'image');

    // 1. 비텍스트 + 비이미지 메시지 → 무시
    if (!messageText && !hasImage) return;

    // 텍스트 또는 이미지 마커를 DB 저장용으로 사용
    const contentToSave = messageText || (hasImage ? `[image] ${attachments![0].payload.url}` : '');

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
    const conversation = await this.getOrCreateConversation(instagramUserId, account);
    const nextIndex = await this.getNextMessageIndex(conversation.id);

    await supabase.from('saju_cs_messages').insert({
      conversation_id: conversation.id,
      message_index: nextIndex,
      role: 'user',
      content: contentToSave,
      source: 'user',
      instagram_mid: messageMid,
    });

    // 4. 활성 리포트 세션 체크 → 세션이 있으면 세션 핸들러로 처리
    const activeSession = await getActiveSession(conversation.id);
    if (activeSession) {
      await handleSessionMessage(activeSession, contentToSave, account);
      await supabase
        .from('saju_cs_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      return;
    }

    // 이미지만 있고 텍스트 없는 경우, 세션 외에서는 더 이상 처리하지 않음
    if (!messageText) return;

    // 4.3. "리포트 재발급" 키워드 감지 → 결제 확인부터 시작
    if (/리포트\s*재발급|보고서\s*재발급|리포트\s*다시/.test(messageText)) {
      // 최근 대화에서 결제 증거 확인
      const { data: recentMsgs } = await supabase
        .from('saju_cs_messages')
        .select('content, role')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: false })
        .limit(30);

      const hasPayment = (recentMsgs || []).some(
        (m) => m.content && (
          m.content.startsWith('[image]') ||
          ['결제', '입금', '송금', '카드', '카카오페이', '네이버페이', '토스', '계좌이체', '무통장', '페이', 'pay']
            .some((kw) => m.content.toLowerCase().includes(kw))
        )
      );

      if (hasPayment) {
        // 결제 확인됨 → 서비스 확인부터 (고객 메시지만 사용, 봇 메시지 제외)
        const userTexts = (recentMsgs || []).filter((m) => m.role === 'user').map((m) => m.content).join(' ');
        const inferredGoodsType = await mapServiceToGoodsType(userTexts);

        if (inferredGoodsType) {
          // 서비스도 추론됨 → 개인정보 단계
          await supabase
            .from('saju_cs_report_sessions')
            .insert({
              account_id: account.id,
              conversation_id: conversation.id,
              instagram_user_id: instagramUserId,
              step: 'awaiting_info',
              goods_type: inferredGoodsType,
              initiated_by: 'dm_reissue',
            });
          await graphApi.sendMessage(instagramUserId, MESSAGES.askInfo, account.instagram_access_token);
        } else {
          // 서비스 추론 못함 → 서비스 확인 단계
          await supabase
            .from('saju_cs_report_sessions')
            .insert({
              account_id: account.id,
              conversation_id: conversation.id,
              instagram_user_id: instagramUserId,
              step: 'awaiting_service',
              initiated_by: 'dm_reissue',
            });
          await graphApi.sendMessage(instagramUserId, MESSAGES.askService, account.instagram_access_token);
        }
      } else {
        // 결제 확인 안됨 → 결제 확인부터 시작
        await createSession({
          accountId: account.id,
          conversationId: conversation.id,
          instagramUserId,
          initiatedBy: 'dm_reissue',
        });
        await graphApi.sendMessage(instagramUserId, MESSAGES.askPaymentFirst, account.instagram_access_token);
      }

      await supabase
        .from('saju_cs_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      return;
    }

    // 4.5. 당첨 DM 후 사용자가 바로 생년월일을 보낸 경우 → 자동 세션 생성
    const autoCreated = await tryAutoSessionFromWinnerDM(
      conversation.id,
      instagramUserId,
      messageText,
      account
    );
    if (autoCreated) {
      await supabase
        .from('saju_cs_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversation.id);
      return;
    }

    // 5. 이미 에스컬레이션 대기 중이면 Slack에 추가 메시지만 전달
    const { data: pendingEscalation } = await supabase
      .from('saju_cs_escalations')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (pendingEscalation) {
      await postFollowUpMessage({
        channelId: account.slack_channel_id,
        username: conversation.instagram_username,
        userQuestion: messageText,
        conversationId: conversation.id,
        instagramUserId: instagramUserId,
        accountId: account.id,
      });
    } else {
      // 5. 승인된 자동 규칙 매칭 시도
      const match = await matchRule(account.id, messageText);

      if (match) {
        // 규칙 매칭 → Slack에 자동 응답 제안 (보내기/거절 버튼)
        const proposedResponse = await generateAutoResponse(match.rule, messageText);

        const { data: pending, error } = await supabase
          .from('saju_cs_pending_responses')
          .insert({
            account_id: account.id,
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
            channelId: account.slack_channel_id,
            accountId: account.id,
            pendingResponseId: pending.id,
            username: conversation.instagram_username,
            customerMessage: messageText,
            proposedResponse,
            category: match.rule.category,
            conversationId: conversation.id,
            instagramUserId: instagramUserId,
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
          accountId: account.id,
          channelId: account.slack_channel_id,
          conversationId: conversation.id,
          instagramUserId,
          username: conversation.instagram_username,
          userQuestion: messageText,
        });
      }
    }

    // 7. 업무 외 시간 → 안내 메시지 전송 (하루 1회)
    if (!isBusinessHours(account)) {
      const tz = account.business_hours_timezone || 'Asia/Seoul';
      const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
      const todayStartUTC = new Date(`${todayStr}T00:00:00+09:00`).toISOString();

      const { count } = await supabase
        .from('saju_cs_messages')
        .select('id', { count: 'exact', head: true })
        .eq('conversation_id', conversation.id)
        .eq('source', 'system')
        .gte('created_at', todayStartUTC);

      const alreadyNotifiedToday = (count ?? 0) > 0;

      if (!alreadyNotifiedToday) {
        const offHoursMsg = account.off_hours_message || templates.getOffHoursMessage();
        await graphApi.sendMessage(instagramUserId, offHoursMsg, account.instagram_access_token);
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

  async getOrCreateConversation(
    instagramUserId: string,
    account: AccountConfig
  ): Promise<Conversation> {
    const { data: existing } = await supabase
      .from('saju_cs_conversations')
      .select('*')
      .eq('account_id', account.id)
      .eq('instagram_user_id', instagramUserId)
      .maybeSingle();

    if (existing) return existing as Conversation;

    const userInfo = await graphApi.getUserInfo(instagramUserId, account.instagram_access_token);

    const { data: created, error } = await supabase
      .from('saju_cs_conversations')
      .insert({
        account_id: account.id,
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
