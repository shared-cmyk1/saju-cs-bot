import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { waitUntil } from '@vercel/functions';
import { supabase } from '@/app/lib/supabase/client';
import { openResponseModal, updateEscalationMessage } from '@/app/lib/slack/slackClient';
import * as graphApi from '@/app/api/instagram/services/graphApi';
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
      const metadata = JSON.parse(action.value);

      await openResponseModal(payload.trigger_id, metadata);

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
  metadata: { conversation_id: string; instagram_user_id: string },
  responseText: string,
  respondedBy: string
) {
  try {
    // 1. Instagram DM으로 답변 전송
    await graphApi.sendMessage(metadata.instagram_user_id, responseText);

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
