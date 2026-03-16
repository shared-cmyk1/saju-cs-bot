import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from '@/app/api/instagram/services/graphApi';
import { createReport, type CreateReunionReportParams } from './reportApiClient';
import type { ReportSession, GoodsType, PersonInfo, AccountConfig } from '@/app/lib/types';

function getAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// === 기본 서비스명 → goodsType 매핑 ===

const DEFAULT_SERVICE_MAP: Record<string, GoodsType> = {
  운해선생: 'CLASSIC',
  윤화보살: 'ROMANTIC',
  연애사주: 'ROMANTIC',
  속박경: 'SPICYSAJU',
  '29금사주': 'SPICYSAJU',
  청연보살: 'REUNION',
  재회사주: 'REUNION',
  재연도: 'REUNION',
};

// === 메시지 템플릿 ===

const MESSAGES = {
  askPaymentFirst:
    '리포트 재발급을 도와드릴게요!\n\n먼저 결제 내역을 확인해야 해요 💳\n결제 내역 캡처 화면을 보내주시거나, 결제 시점과 수단을 알려주세요.\n\n예) 3월 15일 카카오페이로 결제했어요',
  askService:
    '결제 확인 완료! ✅\n\n어떤 서비스를 이용하셨나요?\n(예: 윤화보살, 운해선생, 속박경, 청연보살 등)',
  askInfo:
    '본인의 이름, 성별, 생년월일, 태어난 시간을 알려주세요.\n\n예) 김철수 남자 95년 3월 2일 오후 2시\n\n* 태어난 시간을 모르시면 "모름"이라고 적어주세요.',
  askPartnerInfo:
    '상대방의 이름, 성별, 생년월일, 태어난 시간도 알려주세요.\n\n예) 이영희 여자 97년 5월 15일 오전 8시',
  generating: (url: string) =>
    `리포트 생성을 시작했어요!\n약 2~5분 후 아래 링크에서 확인해주세요 😊\n\n${url}`,
  failed:
    '죄송합니다. 리포트 생성 중 문제가 발생했어요.\n담당자가 확인 후 빠르게 처리해드릴게요 🙏',
  expired:
    '시간이 많이 경과하여 세션이 만료되었습니다.\n다시 문의해주시면 도와드릴게요!',
  cancelled: '리포트 재발급이 취소되었습니다. 다른 문의가 있으시면 말씀해주세요!',
  extractionFailed:
    '입력하신 정보를 정확히 이해하지 못했어요.\n이름, 성별, 생년월일, 태어난 시간을 다시 알려주시겠어요?\n\n예) 김철수 남자 95년 3월 2일 오후 2시',
  serviceNotFound:
    '해당 서비스를 찾지 못했어요.\n아래 서비스 중 하나를 선택해주세요:\n\n• 운해선생\n• 윤화보살 / 연애사주\n• 속박경 / 29금사주\n• 청연보살 / 재회사주 / 재연도',
  askPayment:
    '결제 확인이 필요해요! 💳\n\n결제 내역 캡처 화면을 보내주시거나, 결제 시점과 수단을 알려주세요.\n\n예) 3월 15일 카카오페이로 결제했어요',
  paymentConfirmed:
    '결제 확인 완료! 리포트 생성을 시작할게요 😊',
};

function getServiceMap(account: AccountConfig): Record<string, GoodsType> {
  if (account.service_map && Object.keys(account.service_map).length > 0) {
    // 계정별 맵 + 기본 맵 병합 (계정별이 우선)
    return { ...DEFAULT_SERVICE_MAP, ...(account.service_map as Record<string, GoodsType>) };
  }
  return DEFAULT_SERVICE_MAP;
}

function getReportApiConfig(account: AccountConfig): { url: string; key: string } {
  const url = account.report_api_url || process.env.SAJU_REPORT_API_URL;
  const key = account.report_api_key || process.env.SAJU_REPORT_API_KEY;
  if (!url || !key) throw new Error('Missing report API config');
  return { url, key };
}

export function formatConfirmation(
  goodsType: GoodsType,
  myInfo: PersonInfo,
  partnerInfo?: PersonInfo
): string {
  const genderLabel = (g?: string) => (g === '남' ? '남성' : g === '여' ? '여성' : g || '');
  const timeLabel = (t?: string) => (t === '모름' ? '시간 모름' : t || '');

  let msg = `확인해주세요!\n\n`;
  msg += `서비스: ${goodsType}\n`;
  msg += `이름: ${myInfo.name}\n`;
  msg += `성별: ${genderLabel(myInfo.gender)}\n`;
  msg += `생년월일: ${myInfo.birthdate}\n`;
  msg += `태어난 시간: ${timeLabel(myInfo.birthTime)}\n`;

  if (partnerInfo && partnerInfo.name) {
    msg += `\n[상대방]\n`;
    msg += `이름: ${partnerInfo.name}\n`;
    msg += `성별: ${genderLabel(partnerInfo.gender)}\n`;
    msg += `생년월일: ${partnerInfo.birthdate}\n`;
    msg += `태어난 시간: ${timeLabel(partnerInfo.birthTime)}\n`;
  }

  msg += `\n맞으면 "네", 수정이 필요하면 "아니요"라고 답해주세요.`;
  return msg;
}

// === 세션 관리 ===

export async function getActiveSession(
  conversationId: string
): Promise<ReportSession | null> {
  const { data } = await supabase
    .from('saju_cs_report_sessions')
    .select('*')
    .eq('conversation_id', conversationId)
    .in('step', [
      'awaiting_service',
      'awaiting_info',
      'awaiting_partner_info',
      'confirming',
      'awaiting_payment',
      'generating',
    ])
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as ReportSession | null;
}

export async function createSession(params: {
  accountId: string;
  conversationId: string;
  instagramUserId: string;
  initiatedBy: string;
}): Promise<ReportSession> {
  const { data, error } = await supabase
    .from('saju_cs_report_sessions')
    .insert({
      account_id: params.accountId,
      conversation_id: params.conversationId,
      instagram_user_id: params.instagramUserId,
      step: 'awaiting_payment',
      initiated_by: params.initiatedBy,
    })
    .select('*')
    .single();

  if (error) throw new Error(`Failed to create report session: ${error.message}`);
  return data as ReportSession;
}

async function updateSession(
  sessionId: string,
  updates: Partial<ReportSession>
): Promise<void> {
  await supabase
    .from('saju_cs_report_sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', sessionId);
}

// === 메시지 핸들러 (상태 머신) ===

export async function handleSessionMessage(
  session: ReportSession,
  messageText: string,
  account: AccountConfig
): Promise<void> {
  const userId = session.instagram_user_id;
  const token = account.instagram_access_token;

  // "취소" 감지
  if (/취소|그만|안할래|안 할래/.test(messageText)) {
    await updateSession(session.id, { step: 'expired' });
    await graphApi.sendMessage(userId, MESSAGES.cancelled, token);
    return;
  }

  switch (session.step) {
    case 'awaiting_service':
      await handleAwaitingService(session, messageText, account);
      break;
    case 'awaiting_info':
      await handleAwaitingInfo(session, messageText, account);
      break;
    case 'awaiting_partner_info':
      await handleAwaitingPartnerInfo(session, messageText, account);
      break;
    case 'confirming':
      await handleConfirming(session, messageText, account);
      break;
    case 'awaiting_payment':
      await handleAwaitingPayment(session, messageText, account);
      break;
    case 'generating':
      // 생성 중에는 대기 안내
      await graphApi.sendMessage(
        userId,
        '리포트 생성 중이에요! 완료되면 바로 알려드릴게요 😊',
        token
      );
      break;
  }
}

async function handleAwaitingService(
  session: ReportSession,
  messageText: string,
  account: AccountConfig
): Promise<void> {
  const serviceMap = getServiceMap(account);
  const goodsType = await mapServiceToGoodsType(messageText, serviceMap);

  if (!goodsType) {
    await graphApi.sendMessage(session.instagram_user_id, MESSAGES.serviceNotFound, account.instagram_access_token);
    return;
  }

  await updateSession(session.id, {
    goods_type: goodsType,
    step: 'awaiting_info',
  });
  await graphApi.sendMessage(session.instagram_user_id, MESSAGES.askInfo, account.instagram_access_token);
}

async function handleAwaitingInfo(
  session: ReportSession,
  messageText: string,
  account: AccountConfig
): Promise<void> {
  const keyPrefix = process.env.ANTHROPIC_API_KEY?.substring(0, 20) || 'NO_KEY';
  const info = await extractPersonInfo(messageText);
  const errMsg = (info as unknown as {_error?: string})?._error || '';

  // 키 + 입력 + 결과를 한번에 기록
  await supabase
    .from('saju_cs_report_sessions')
    .update({ shop_order_no: `KEY:${keyPrefix} | IN:${messageText.substring(0, 40)} | ${errMsg ? 'ERR:' + errMsg.substring(0, 80) : 'OK:' + JSON.stringify(info).substring(0, 80)}` })
    .eq('id', session.id);

  if (!info || !info.name || !info.gender || !info.birthdate) {
    await graphApi.sendMessage(
      session.instagram_user_id,
      MESSAGES.extractionFailed,
      account.instagram_access_token
    );
    return;
  }

  await updateSession(session.id, { my_info: info });

  // REUNION → 상대방 정보도 필요
  if (session.goods_type === 'REUNION') {
    await updateSession(session.id, { step: 'awaiting_partner_info', my_info: info });
    await graphApi.sendMessage(
      session.instagram_user_id,
      MESSAGES.askPartnerInfo,
      account.instagram_access_token
    );
    return;
  }

  // 확인 단계로 이동
  await updateSession(session.id, { step: 'confirming', my_info: info });
  const confirmMsg = formatConfirmation(session.goods_type!, info);
  await graphApi.sendMessage(session.instagram_user_id, confirmMsg, account.instagram_access_token);
}

async function handleAwaitingPartnerInfo(
  session: ReportSession,
  messageText: string,
  account: AccountConfig
): Promise<void> {
  const info = await extractPersonInfo(messageText);

  if (!info || !info.name || !info.gender || !info.birthdate) {
    await graphApi.sendMessage(
      session.instagram_user_id,
      MESSAGES.extractionFailed,
      account.instagram_access_token
    );
    return;
  }

  await updateSession(session.id, {
    step: 'confirming',
    partner_info: info,
  });

  const confirmMsg = formatConfirmation(
    session.goods_type!,
    session.my_info,
    info
  );
  await graphApi.sendMessage(session.instagram_user_id, confirmMsg, account.instagram_access_token);
}

async function handleConfirming(
  session: ReportSession,
  messageText: string,
  account: AccountConfig
): Promise<void> {
  const normalized = messageText.trim();

  // "네" → 리포트 생성 (결제는 이미 앞 단계에서 확인됨)
  if (/^(네|넵|넹|예|응|맞아|맞습니다|ㅇ|ㅇㅇ|ok|yes)$/i.test(normalized)) {
    await submitReport(session, account);
    return;
  }

  // "아니요" → 처음부터 다시
  if (/^(아니|아니요|아뇨|ㄴ|ㄴㄴ|no)$/i.test(normalized)) {
    await updateSession(session.id, {
      step: 'awaiting_info',
      my_info: {} as PersonInfo,
      partner_info: {} as PersonInfo,
    });
    await graphApi.sendMessage(session.instagram_user_id, MESSAGES.askInfo, account.instagram_access_token);
    return;
  }

  // 이해 못함 → 다시 물어보기
  await graphApi.sendMessage(
    session.instagram_user_id,
    '맞으면 "네", 수정이 필요하면 "아니요"라고 답해주세요.',
    account.instagram_access_token
  );
}

// === AI 추출 ===

export async function extractPersonInfo(
  messageText: string
): Promise<PersonInfo | null> {
  const MAX_RETRIES = 2;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await getAnthropic().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        temperature: 0,
        system: `사용자 메시지에서 사주 리포트에 필요한 인적 정보를 추출하세요.
반드시 아래 JSON 형식으로만 응답하세요.
{
  "name": "이름",
  "gender": "남" 또는 "여",
  "birthdate": "YYYYMMDD 형식",
  "birthTime": "HH:mm 형식 (24시간제). 모르면 '모름'"
}
- 연도가 2자리면 적절히 4자리로 변환 (예: 95 → 1995, 05 → 2005)
- 정보가 부족하면 해당 필드를 null로 설정
- JSON만 출력하세요.`,
        messages: [{ role: 'user', content: messageText }],
      });

      const text =
        response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(jsonStr);
      return parsed as PersonInfo;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      if (attempt < MAX_RETRIES) {
        console.warn(`[ReportService] extractPersonInfo attempt ${attempt + 1} failed, retrying:`, errorMsg);
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      console.error('[ReportService] extractPersonInfo failed after retries:', errorMsg);
      return { _error: errorMsg } as unknown as PersonInfo;
    }
  }
  return null;
}

export async function mapServiceToGoodsType(
  messageText: string,
  serviceMap?: Record<string, GoodsType>
): Promise<GoodsType | null> {
  const map = serviceMap || DEFAULT_SERVICE_MAP;
  const normalized = messageText.replace(/\s+/g, '').toLowerCase();

  // 1. 직접 매칭: 메시지에 키워드가 포함되어 있거나, 키워드에 메시지가 포함 (부분 매칭)
  for (const [keyword, goodsType] of Object.entries(map)) {
    const normalizedKeyword = keyword.replace(/\s+/g, '').toLowerCase();
    if (normalized.includes(normalizedKeyword) || normalizedKeyword.includes(normalized)) {
      return goodsType;
    }
  }

  // 2. AI 퍼지 매칭 (오타, 별칭 등 처리, 재시도 포함)
  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      const serviceList = Object.keys(map).join(', ');
      const response = await getAnthropic().messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        temperature: 0,
        system: `사용자가 언급한 사주 서비스명을 아래 목록에서 찾으세요.
서비스 목록: ${serviceList}
부분 일치, 줄임말, 오타도 고려하세요.
매칭되는 서비스명만 정확히 출력하세요. 매칭되지 않으면 "없음"이라고 출력하세요.`,
        messages: [{ role: 'user', content: messageText }],
      });

      const text =
        response.content[0].type === 'text'
          ? response.content[0].text.trim()
          : '';

      if (text === '없음') return null;
      // AI 응답도 부분 매칭으로 찾기
      for (const [keyword, goodsType] of Object.entries(map)) {
        if (text.includes(keyword) || keyword.includes(text)) {
          return goodsType;
        }
      }
      return map[text] || null;
    } catch (error) {
      if (attempt === 0) {
        console.warn('[ReportService] mapServiceToGoodsType retrying:', error);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      console.error('[ReportService] mapServiceToGoodsType failed:', error);
      return null;
    }
  }
  return null;
}

// === 당첨 DM → 자동 리포트 세션 ===

/**
 * 최근 봇 메시지에서 "당첨" 키워드 + 서비스명을 감지하여
 * 자동으로 리포트 세션을 생성하고 사용자 정보를 추출한다.
 * 사용자가 생년월일을 바로 보낼 때 세션 없이도 리포트를 시작할 수 있다.
 */
export async function tryAutoSessionFromWinnerDM(
  conversationId: string,
  instagramUserId: string,
  messageText: string,
  account: AccountConfig
): Promise<boolean> {
  // 최근 봇 메시지 5개 조회
  const { data: recentMessages } = await supabase
    .from('saju_cs_messages')
    .select('content, role')
    .eq('conversation_id', conversationId)
    .eq('role', 'assistant')
    .order('created_at', { ascending: false })
    .limit(5);

  if (!recentMessages || recentMessages.length === 0) return false;

  // "당첨" 키워드가 포함된 봇 메시지 찾기
  const winnerMsg = recentMessages.find(
    (m) => m.content && m.content.includes('당첨')
  );
  if (!winnerMsg) return false;

  // 당첨 메시지에서 서비스명 추출
  const serviceMap = getServiceMap(account);
  const goodsType = await mapServiceToGoodsType(winnerMsg.content, serviceMap);
  if (!goodsType) return false;

  // 사용자 메시지에서 개인정보 추출 시도
  const info = await extractPersonInfo(messageText);
  if (!info || !info.name || !info.gender || !info.birthdate) return false;

  // 세션 생성 → awaiting_info 건너뛰고 바로 confirming 단계로
  const { data: session, error } = await supabase
    .from('saju_cs_report_sessions')
    .insert({
      account_id: account.id,
      conversation_id: conversationId,
      instagram_user_id: instagramUserId,
      step: 'confirming',
      goods_type: goodsType,
      my_info: info,
      initiated_by: 'auto_winner',
    })
    .select('*')
    .single();

  if (error || !session) {
    console.error('[ReportService] Auto session creation failed:', error);
    return false;
  }

  // 확인 메시지 전송
  const confirmMsg = formatConfirmation(goodsType, info);
  await graphApi.sendMessage(instagramUserId, confirmMsg, account.instagram_access_token);

  console.log(
    '[ReportService] Auto session created from winner DM: conversation=%s, goodsType=%s',
    conversationId, goodsType
  );
  return true;
}

// === 결제 확인 ===

const PAYMENT_KEYWORDS = ['결제', '입금', '송금', '카드', '카카오페이', '네이버페이', '토스', '계좌이체', '무통장', '페이', 'pay'];

function hasPaymentEvidence(content: string): boolean {
  if (content.startsWith('[image]')) return true;
  const lower = content.toLowerCase();
  return PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

async function checkPaymentAndSubmit(
  session: ReportSession,
  account: AccountConfig
): Promise<void> {
  const { data: recentMessages } = await supabase
    .from('saju_cs_messages')
    .select('content, role')
    .eq('conversation_id', session.conversation_id)
    .order('created_at', { ascending: false })
    .limit(30);

  if (recentMessages) {
    const found = recentMessages.some(
      (m) => m.content && hasPaymentEvidence(m.content)
    );
    if (found) {
      await submitReport(session, account);
      return;
    }
  }

  // 결제 증거 없음 → 결제 확인 요청
  await graphApi.sendMessage(
    session.instagram_user_id,
    MESSAGES.askPayment,
    account.instagram_access_token
  );
  await updateSession(session.id, { step: 'awaiting_payment' });
}

async function handleAwaitingPayment(
  session: ReportSession,
  messageText: string,
  account: AccountConfig
): Promise<void> {
  if (hasPaymentEvidence(messageText)) {
    // 결제 확인 완료 → 서비스 확인 단계로
    await updateSession(session.id, { step: 'awaiting_service' });
    await graphApi.sendMessage(
      session.instagram_user_id,
      MESSAGES.askService,
      account.instagram_access_token
    );
    return;
  }

  // 결제 증거 아님 → 다시 안내
  await graphApi.sendMessage(
    session.instagram_user_id,
    '결제 내역 캡처를 보내주시거나, 결제 방법을 알려주세요!',
    account.instagram_access_token
  );
}

// === 리포트 생성 ===

async function submitReport(session: ReportSession, account: AccountConfig): Promise<void> {
  try {
    const myInfo = session.my_info;

    const params =
      session.goods_type === 'REUNION'
        ? ({
            goodsType: 'REUNION',
            myName: myInfo.name!,
            myGender: myInfo.gender!,
            myBirthdate: myInfo.birthdate!,
            myBirthTime: myInfo.birthTime || 'unknown',
            partnerName: session.partner_info?.name || '상대방',
            partnerGender: session.partner_info?.gender || '여',
            partnerBirthdate: session.partner_info?.birthdate || '',
            partnerBirthTime: session.partner_info?.birthTime || 'unknown',
          } satisfies CreateReunionReportParams)
        : {
            goodsType: session.goods_type!,
            name: myInfo.name!,
            gender: myInfo.gender!,
            birthdate: myInfo.birthdate!,
            birthTime: myInfo.birthTime || 'unknown',
          };

    const apiConfig = getReportApiConfig(account);
    const result = await createReport(params, apiConfig.url, apiConfig.key);

    await updateSession(session.id, {
      step: 'completed',
      shop_order_no: result.shopOrderNo,
      report_url: result.reportUrl,
    });

    await graphApi.sendMessage(
      session.instagram_user_id,
      MESSAGES.generating(result.reportUrl),
      account.instagram_access_token
    );
  } catch (error) {
    console.error('[ReportService] submitReport error:', error);
    await updateSession(session.id, { step: 'failed' });
    await graphApi.sendMessage(session.instagram_user_id, MESSAGES.failed, account.instagram_access_token);
  }
}

export { MESSAGES };
