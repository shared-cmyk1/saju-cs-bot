import { supabase } from '@/app/lib/supabase/client';
import type { SlackEscalationParams, CategoryAnalysis } from '@/app/lib/types';

function getSlackToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('Missing SLACK_BOT_TOKEN');
  return token;
}

// Slack Web API 호출 헬퍼
async function slackAPI(method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getSlackToken()}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!data.ok) {
    console.error(`[Slack] ${method} failed:`, data.error);
    throw new Error(`Slack API error: ${data.error}`);
  }
  return data;
}

// 에스컬레이션 메시지를 Slack에 포스트
export async function postEscalation(params: SlackEscalationParams): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'CS 문의 에스컬레이션', emoji: true },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*고객:*\n@${params.username || '알 수 없음'}`,
        },
        {
          type: 'mrkdwn',
          text: '*상태:*\n:hourglass: 대기 중',
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*질문:*\n>${params.userQuestion}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '답변하기', emoji: true },
          style: 'primary',
          action_id: 'open_response_modal',
          value: JSON.stringify({
            conversation_id: params.conversationId,
            instagram_user_id: params.instagramUserId,
            account_id: params.accountId,
          }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '리포트 재발급', emoji: true },
          action_id: 'start_report_reissue',
          value: JSON.stringify({
            conversation_id: params.conversationId,
            instagram_user_id: params.instagramUserId,
            account_id: params.accountId,
          }),
        },
      ],
    },
  ];

  const result = await slackAPI('chat.postMessage', {
    channel: params.channelId,
    text: `CS 에스컬레이션: @${params.username || '알 수 없음'} - "${params.userQuestion}"`,
    blocks,
  });

  // DB에 에스컬레이션 레코드 생성
  const { data: lastUserMsg } = await supabase
    .from('saju_cs_messages')
    .select('id')
    .eq('conversation_id', params.conversationId)
    .eq('role', 'user')
    .order('message_index', { ascending: false })
    .limit(1)
    .single();

  if (lastUserMsg) {
    await supabase.from('saju_cs_escalations').insert({
      account_id: params.accountId,
      conversation_id: params.conversationId,
      user_message_id: lastUserMsg.id,
      slack_channel_id: result.channel,
      slack_message_ts: result.ts,
      status: 'pending',
    });
  }
}

// 이미 에스컬레이션 진행 중인 대화에서 추가 메시지를 Slack에 전달
export async function postFollowUpMessage(params: {
  channelId: string;
  username?: string | null;
  userQuestion: string;
}): Promise<void> {
  await slackAPI('chat.postMessage', {
    channel: params.channelId,
    text: `📩 추가 메시지 | @${params.username || '알 수 없음'}: "${params.userQuestion}"`,
  });
}

// 에스컬레이션 메시지를 "답변 완료"로 업데이트
export async function updateEscalationMessage(
  channel: string,
  ts: string,
  respondedBy: string,
  userQuestion: string
): Promise<void> {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'CS 문의 에스컬레이션', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*질문:*\n>${userQuestion}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:white_check_mark: *답변 완료* by @${respondedBy}`,
      },
    },
  ];

  await slackAPI('chat.update', {
    channel,
    ts,
    text: `CS 답변 완료 by @${respondedBy}`,
    blocks,
  });
}

// 카테고리 학습 완료 제안 ("이 카테고리 학습 완료됐어요" + 승인/거절)
export async function postAutoRuleProposal(
  analysis: CategoryAnalysis,
  channelId: string,
  accountId: string
): Promise<{ channelId: string; messageTs: string }> {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '자동 응답 학습 완료', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*카테고리:* ${analysis.category}\n*설명:* ${analysis.description}\n*학습 건수:* ${analysis.pairCount}건`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*템플릿 응답:*\n>${analysis.templateResponse}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*예시 질문:*\n${analysis.exampleQuestions.map((q) => `• ${q}`).join('\n')}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '승인', emoji: true },
          style: 'primary',
          action_id: 'approve_auto_rule',
          value: JSON.stringify({ category: analysis.category, account_id: accountId }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '거절', emoji: true },
          style: 'danger',
          action_id: 'reject_auto_rule',
          value: JSON.stringify({ category: analysis.category, account_id: accountId }),
        },
      ],
    },
  ];

  const result = await slackAPI('chat.postMessage', {
    channel: channelId,
    text: `자동 응답 학습 완료: ${analysis.category} (${analysis.pairCount}건)`,
    blocks,
  });

  return { channelId: result.channel, messageTs: result.ts };
}

// 건별 응답 제안 ("이 고객에게 이렇게 답변할까요?" + 보내기/거절)
export async function postResponseProposal(params: {
  channelId: string;
  accountId: string;
  pendingResponseId: string;
  username: string | null;
  customerMessage: string;
  proposedResponse: string;
  category: string;
  conversationId?: string;
  instagramUserId?: string;
}): Promise<{ channelId: string; messageTs: string }> {
  const actionButtons: Record<string, unknown>[] = [
    {
      type: 'button',
      text: { type: 'plain_text', text: '보내기', emoji: true },
      style: 'primary',
      action_id: 'send_proposed_response',
      value: JSON.stringify({ pending_id: params.pendingResponseId, account_id: params.accountId }),
    },
    {
      type: 'button',
      text: { type: 'plain_text', text: '거절', emoji: true },
      style: 'danger',
      action_id: 'reject_proposed_response',
      value: JSON.stringify({ pending_id: params.pendingResponseId, account_id: params.accountId }),
    },
  ];

  // 결제오류_결과미수신 카테고리 → 리포트 재발급 버튼 추가
  if (
    params.category === '결제오류_결과미수신' &&
    params.conversationId &&
    params.instagramUserId
  ) {
    actionButtons.push({
      type: 'button',
      text: { type: 'plain_text', text: '리포트 재발급', emoji: true },
      action_id: 'start_report_reissue',
      value: JSON.stringify({
        conversation_id: params.conversationId,
        instagram_user_id: params.instagramUserId,
        account_id: params.accountId,
      }),
    });
  }

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '자동 응답 제안', emoji: true },
    },
    {
      type: 'section',
      fields: [
        {
          type: 'mrkdwn',
          text: `*고객:*\n@${params.username || '알 수 없음'}`,
        },
        {
          type: 'mrkdwn',
          text: `*매칭 카테고리:*\n${params.category}`,
        },
      ],
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*고객 메시지:*\n>${params.customerMessage}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*제안 응답:*\n${params.proposedResponse}`,
      },
    },
    {
      type: 'actions',
      elements: actionButtons,
    },
  ];

  const result = await slackAPI('chat.postMessage', {
    channel: params.channelId,
    text: `자동 응답 제안 | @${params.username || '알 수 없음'}: "${params.customerMessage}"`,
    blocks,
  });

  return { channelId: result.channel, messageTs: result.ts };
}

// 카테고리 제안 승인/거절 후 메시지 업데이트
export async function updateAutoRuleMessage(
  channel: string,
  ts: string,
  category: string,
  approved: boolean,
  respondedBy: string
): Promise<void> {
  const statusText = approved
    ? `:white_check_mark: *승인됨* by @${respondedBy}`
    : `:x: *거절됨* by @${respondedBy}`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '자동 응답 학습 완료', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*카테고리:* ${category}\n${statusText}`,
      },
    },
  ];

  await slackAPI('chat.update', {
    channel,
    ts,
    text: `자동 응답 ${approved ? '승인' : '거절'}: ${category} by @${respondedBy}`,
    blocks,
  });
}

// 건별 제안 승인/거절 후 메시지 업데이트
export async function updateResponseProposal(
  channel: string,
  ts: string,
  approved: boolean,
  respondedBy: string,
  customerMessage: string
): Promise<void> {
  const statusText = approved
    ? `:white_check_mark: *전송 완료* by @${respondedBy}`
    : `:x: *거절됨* by @${respondedBy}`;

  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: '자동 응답 제안', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*고객 메시지:*\n>${customerMessage}\n\n${statusText}`,
      },
    },
  ];

  await slackAPI('chat.update', {
    channel,
    ts,
    text: `자동 응답 ${approved ? '전송' : '거절'} by @${respondedBy}`,
    blocks,
  });
}

// 응답 모달 열기
export async function openResponseModal(
  triggerId: string,
  metadata: Record<string, string>
): Promise<void> {
  await slackAPI('views.open', {
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'cs_response_modal',
      private_metadata: JSON.stringify(metadata),
      title: { type: 'plain_text', text: '고객 답변' },
      submit: { type: 'plain_text', text: '전송' },
      blocks: [
        {
          type: 'input',
          block_id: 'response_block',
          label: { type: 'plain_text', text: '답변 내용' },
          element: {
            type: 'plain_text_input',
            action_id: 'response_text',
            multiline: true,
            placeholder: {
              type: 'plain_text',
              text: '고객에게 보낼 답변을 입력하세요...',
            },
          },
        },
      ],
    },
  });
}
