import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/app/lib/supabase/client';
import {
  openResponseModal,
  updateEscalationMessage,
  updateAutoRuleMessage,
  updateResponseProposal,
} from '@/app/lib/slack/slackClient';
import { invalidateRuleCache } from '@/app/lib/ai/learningService';
import {
  createSession,
  MESSAGES,
} from '@/app/lib/report/reportService';
import * as graphApi from '@/app/api/instagram/services/graphApi';
import { resolveAccountById } from '@/app/lib/account/accountResolver';
import type { SlackInteractionPayload } from '@/app/lib/types';

// Slack signing secret 검증
function verifySlackRequest(
  body: string,
  timestamp: string,
  signature: string
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) return false;

  // 5분 이상 오래된 요청 거부
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature =
    'v0=' +
    crypto
      .createHmac('sha256', signingSecret)
      .update(sigBasestring)
      .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  // Slack 요청 검증
  const timestamp = request.headers.get('x-slack-request-timestamp') || '';
  const signature = request.headers.get('x-slack-signature') || '';

  if (!verifySlackRequest(rawBody, timestamp, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // Slack은 payload를 form-urlencoded로 보냄
  const params = new URLSearchParams(rawBody);
  const payloadStr = params.get('payload');
  if (!payloadStr) {
    return NextResponse.json({ error: 'No payload' }, { status: 400 });
  }

  const payload: SlackInteractionPayload = JSON.parse(payloadStr);

  // 버튼 클릭: 모달 열기
  if (payload.type === 'block_actions' && payload.actions) {
    const action = payload.actions[0];

    if (action.action_id === 'open_response_modal' && payload.trigger_id) {
      // metadata에 account_id 포함됨
      const metadata = JSON.parse(action.value);
      await openResponseModal(payload.trigger_id, metadata);
      return new NextResponse('', { status: 200 });
    }

    // 카테고리 학습 승인
    if (action.action_id === 'approve_auto_rule') {
      const { category, account_id } = JSON.parse(action.value);
      waitUntil(handleAutoRuleAction(account_id, category, true, payload.user.username, payload));
      return new NextResponse('', { status: 200 });
    }

    // 카테고리 학습 거절
    if (action.action_id === 'reject_auto_rule') {
      const { category, account_id } = JSON.parse(action.value);
      waitUntil(handleAutoRuleAction(account_id, category, false, payload.user.username, payload));
      return new NextResponse('', { status: 200 });
    }

    // 건별 응답 승인 (보내기)
    if (action.action_id === 'send_proposed_response') {
      const { pending_id, account_id } = JSON.parse(action.value);
      waitUntil(handleProposedResponseAction(account_id, pending_id, true, payload.user.username));
      return new NextResponse('', { status: 200 });
    }

    // 건별 응답 거절
    if (action.action_id === 'reject_proposed_response') {
      const { pending_id, account_id } = JSON.parse(action.value);
      waitUntil(handleProposedResponseAction(account_id, pending_id, false, payload.user.username));
      return new NextResponse('', { status: 200 });
    }

    // 리포트 재발급 시작
    if (action.action_id === 'start_report_reissue') {
      const metadata = JSON.parse(action.value);
      waitUntil(
        handleStartReportReissue(
          metadata.account_id,
          metadata.conversation_id,
          metadata.instagram_user_id,
          payload.user.username
        )
      );
      return new NextResponse('', { status: 200 });
    }
  }

  // 모달 제출: Instagram DM 전송
  if (payload.type === 'view_submission' && payload.view) {
    const metadata = JSON.parse(payload.view.private_metadata);
    const responseText =
      payload.view.state.values.response_block.response_text.value;
    const respondedBy = payload.user.username;

    // Slack에 즉시 200 반환, 나머지 비동기 처리
    const processingPromise = handleModalSubmission(
      metadata,
      responseText,
      respondedBy
    );
    waitUntil(processingPromise);

    return new NextResponse('', { status: 200 });
  }

  return new NextResponse('', { status: 200 });
}

async function handleModalSubmission(
  metadata: { conversation_id: string; instagram_user_id: string; account_id: string },
  responseText: string,
  respondedBy: string
) {
  try {
    // 계정 조회
    const account = await resolveAccountById(metadata.account_id);
    if (!account) {
      console.error('[SlackInteraction] Account not found:', metadata.account_id);
      return;
    }

    // 1. Instagram DM으로 답변 전송
    await graphApi.sendMessage(metadata.instagram_user_id, responseText, account.instagram_access_token);

    // 2. DB에 답변 메시지 저장
    const { data: lastMsg } = await supabase
      .from('saju_cs_messages')
      .select('message_index')
      .eq('conversation_id', metadata.conversation_id)
      .order('message_index', { ascending: false })
      .limit(1)
      .single();

    const nextIndex = lastMsg ? lastMsg.message_index + 1 : 0;

    await supabase.from('saju_cs_messages').insert({
      conversation_id: metadata.conversation_id,
      message_index: nextIndex,
      role: 'assistant',
      content: responseText,
      source: 'human',
    });

    // 3. 에스컬레이션 상태 업데이트
    const { data: escalation } = await supabase
      .from('saju_cs_escalations')
      .select('id, slack_channel_id, slack_message_ts, user_message_id')
      .eq('conversation_id', metadata.conversation_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (escalation) {
      await supabase
        .from('saju_cs_escalations')
        .update({
          status: 'answered',
          team_response: responseText,
          responded_by: respondedBy,
          responded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', escalation.id);

      // 4. 원래 질문 가져오기
      const { data: userMsg } = await supabase
        .from('saju_cs_messages')
        .select('content')
        .eq('id', escalation.user_message_id)
        .single();

      // 5. Slack 메시지 업데이트 (답변 완료 표시)
      await updateEscalationMessage(
        escalation.slack_channel_id,
        escalation.slack_message_ts,
        respondedBy,
        userMsg?.content || ''
      );
    }

    console.log('[SlackInteraction] Response sent successfully:', {
      conversationId: metadata.conversation_id,
      respondedBy,
    });
  } catch (error) {
    console.error('[SlackInteraction] Failed to send response:', error);
  }
}

// 카테고리 학습 승인/거절 처리
async function handleAutoRuleAction(
  accountId: string,
  category: string,
  approved: boolean,
  respondedBy: string,
  payload: SlackInteractionPayload
) {
  try {
    const newStatus = approved ? 'approved' : 'rejected';

    const { data: rule } = await supabase
      .from('saju_cs_auto_rules')
      .select('id, slack_channel_id, slack_message_ts')
      .eq('account_id', accountId)
      .eq('category', category)
      .eq('status', 'proposed')
      .maybeSingle();

    if (!rule) return;

    await supabase
      .from('saju_cs_auto_rules')
      .update({
        status: newStatus,
        approved_by: approved ? respondedBy : null,
        approved_at: approved ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', rule.id);

    // 캐시 무효화
    invalidateRuleCache(accountId);

    // Slack 메시지 업데이트
    if (rule.slack_channel_id && rule.slack_message_ts) {
      await updateAutoRuleMessage(
        rule.slack_channel_id,
        rule.slack_message_ts,
        category,
        approved,
        respondedBy
      );
    }

    console.log(`[SlackInteraction] Auto rule ${newStatus}:`, category);
  } catch (error) {
    console.error('[SlackInteraction] Auto rule action error:', error);
  }
}

// 건별 응답 승인/거절 처리
async function handleProposedResponseAction(
  accountId: string,
  pendingId: string,
  approved: boolean,
  respondedBy: string
) {
  try {
    const { data: pending } = await supabase
      .from('saju_cs_pending_responses')
      .select('*')
      .eq('id', pendingId)
      .eq('status', 'pending')
      .maybeSingle();

    if (!pending) return;

    // 계정 조회
    const account = await resolveAccountById(accountId);
    if (!account) {
      console.error('[SlackInteraction] Account not found:', accountId);
      return;
    }

    if (approved) {
      // Instagram DM 전송
      await graphApi.sendMessage(pending.instagram_user_id, pending.proposed_response, account.instagram_access_token);

      // 답변 메시지 DB 저장
      const { data: lastMsg } = await supabase
        .from('saju_cs_messages')
        .select('message_index')
        .eq('conversation_id', pending.conversation_id)
        .order('message_index', { ascending: false })
        .limit(1)
        .single();

      const nextIndex = lastMsg ? lastMsg.message_index + 1 : 0;

      await supabase.from('saju_cs_messages').insert({
        conversation_id: pending.conversation_id,
        message_index: nextIndex,
        role: 'assistant',
        content: pending.proposed_response,
        source: 'ai',
      });
    }

    // pending response 상태 업데이트
    await supabase
      .from('saju_cs_pending_responses')
      .update({
        status: approved ? 'sent' : 'rejected',
        responded_by: respondedBy,
      })
      .eq('id', pendingId);

    // Slack 메시지 업데이트
    if (pending.slack_channel_id && pending.slack_message_ts) {
      await updateResponseProposal(
        pending.slack_channel_id,
        pending.slack_message_ts,
        approved,
        respondedBy,
        pending.customer_message
      );
    }

    console.log(`[SlackInteraction] Proposed response ${approved ? 'sent' : 'rejected'}:`, pendingId);
  } catch (error) {
    console.error('[SlackInteraction] Proposed response action error:', error);
  }
}

// 리포트 재발급 시작
async function handleStartReportReissue(
  accountId: string,
  conversationId: string,
  instagramUserId: string,
  initiatedBy: string
) {
  try {
    const account = await resolveAccountById(accountId);
    if (!account) {
      console.error('[SlackInteraction] Account not found:', accountId);
      return;
    }

    await createSession({
      accountId: account.id,
      conversationId,
      instagramUserId,
      initiatedBy,
    });

    await graphApi.sendMessage(instagramUserId, MESSAGES.askService, account.instagram_access_token);

    console.log('[SlackInteraction] Report reissue started:', {
      conversationId,
      initiatedBy,
    });
  } catch (error) {
    console.error('[SlackInteraction] Report reissue error:', error);
  }
}
