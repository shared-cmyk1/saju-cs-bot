import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/app/lib/supabase/client';
import { postAutoRuleProposal } from '@/app/lib/slack/slackClient';
import type { AutoRule, CategoryAnalysis } from '@/app/lib/types';

const anthropic = new Anthropic();

const CATEGORY_THRESHOLD = 5;
const MATCH_CONFIDENCE_THRESHOLD = 0.85;
const RULE_CACHE_TTL_MS = 2 * 60 * 1000; // 2분

// 계정별 승인된 규칙 캐시
const ruleCache = new Map<string, { rules: AutoRule[]; timestamp: number }>();

// Q&A 쌍 저장 → 카테고리 분류 → 임계값 확인 → 제안 트리거
export async function captureLearningPair(
  accountId: string,
  channelId: string,
  conversationId: string,
  customerMessage: string,
  agentResponse: string
): Promise<void> {
  try {
    // 카테고리 분류
    const category = await categorizePair(customerMessage, agentResponse);

    // Q&A 쌍 저장
    await supabase.from('saju_cs_learning_pairs').insert({
      account_id: accountId,
      conversation_id: conversationId,
      customer_message: customerMessage,
      agent_response: agentResponse,
      category,
      categorized_at: category ? new Date().toISOString() : null,
    });

    if (!category) return;

    // 해당 카테고리의 기존 규칙 확인 (이미 제안/승인/거절된 경우 스킵)
    const { data: existingRule } = await supabase
      .from('saju_cs_auto_rules')
      .select('id, status')
      .eq('account_id', accountId)
      .eq('category', category)
      .maybeSingle();

    if (existingRule) return;

    // 같은 카테고리 건수 확인
    const { count } = await supabase
      .from('saju_cs_learning_pairs')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('category', category);

    if (!count || count < CATEGORY_THRESHOLD) return;

    // 임계값 도달 → 카테고리 분석 및 Slack 제안
    await analyzeCategory(accountId, channelId, category);
  } catch (error) {
    console.error('[LearningService] captureLearningPair error:', error);
  }
}

// Claude Haiku로 카테고리 분류
async function categorizePair(
  customerMessage: string,
  agentResponse: string
): Promise<string | null> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      temperature: 0,
      system: `고객 상담 Q&A를 분류하세요. 한국어 카테고리명을 하나만 출력하세요.
예시: 가격문의, 결제방법, 서비스이용방법, 환불요청, 배송문의, 계정문제, 사주해석요청, 이벤트문의, 일반인사
카테고리명만 출력하고 다른 텍스트는 포함하지 마세요.`,
      messages: [
        {
          role: 'user',
          content: `고객: ${customerMessage}\n답변: ${agentResponse}`,
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text.trim() : null;
    return text || null;
  } catch (error) {
    console.error('[LearningService] categorizePair error:', error);
    return null;
  }
}

// 카테고리 분석: AI가 템플릿 생성 + Slack 제안
async function analyzeCategory(
  accountId: string,
  channelId: string,
  category: string
): Promise<void> {
  // 해당 카테고리의 Q&A 쌍 조회
  const { data: pairs } = await supabase
    .from('saju_cs_learning_pairs')
    .select('customer_message, agent_response')
    .eq('account_id', accountId)
    .eq('category', category)
    .order('created_at', { ascending: false })
    .limit(10);

  if (!pairs || pairs.length === 0) return;

  // AI로 템플릿 응답 생성
  const analysis = await generateCategoryTemplate(category, pairs);
  if (!analysis) return;

  // Slack에 카테고리 제안 → ts 받아서 DB에 저장
  const { channelId: resultChannelId, messageTs } = await postAutoRuleProposal(
    analysis,
    channelId,
    accountId
  );

  await supabase.from('saju_cs_auto_rules').insert({
    account_id: accountId,
    category: analysis.category,
    description: analysis.description,
    template_response: analysis.templateResponse,
    example_questions: analysis.exampleQuestions,
    pair_count: analysis.pairCount,
    status: 'proposed',
    slack_message_ts: messageTs,
    slack_channel_id: resultChannelId,
  });

  console.log('[LearningService] Category proposal sent:', category);
}

// AI로 카테고리 템플릿 응답 생성
async function generateCategoryTemplate(
  category: string,
  pairs: Array<{ customer_message: string; agent_response: string }>
): Promise<CategoryAnalysis | null> {
  try {
    const pairsText = pairs
      .map((p, i) => `${i + 1}. 질문: ${p.customer_message}\n   답변: ${p.agent_response}`)
      .join('\n\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0.3,
      system: `고객 상담 Q&A 쌍들을 분석해서 자동 응답 템플릿을 만드세요.
반드시 아래 JSON 형식으로만 응답하세요.
{
  "description": "이 카테고리에 대한 간단한 설명",
  "templateResponse": "자동 응답 템플릿 (고객 질문에 맞게 약간 변형 가능한 범용 답변)",
  "exampleQuestions": ["예시 질문 1", "예시 질문 2", "예시 질문 3"]
}`,
      messages: [
        {
          role: 'user',
          content: `카테고리: ${category}\n\nQ&A 쌍들:\n${pairsText}`,
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      category,
      description: parsed.description,
      templateResponse: parsed.templateResponse,
      exampleQuestions: parsed.exampleQuestions || [],
      pairCount: pairs.length,
    };
  } catch (error) {
    console.error('[LearningService] generateCategoryTemplate error:', error);
    return null;
  }
}

// 승인된 규칙 매칭 (confidence >= 0.85)
export async function matchRule(
  accountId: string,
  customerMessage: string
): Promise<{ rule: AutoRule; confidence: number } | null> {
  const rules = await getApprovedRules(accountId);
  if (rules.length === 0) return null;

  try {
    const rulesDescription = rules
      .map(
        (r) =>
          `ID: ${r.id}\n카테고리: ${r.category}\n설명: ${r.description}\n예시 질문: ${r.example_questions.join(', ')}`
      )
      .join('\n---\n');

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      temperature: 0,
      system: `고객 메시지가 아래 규칙 중 하나에 매칭되는지 판단하세요.
매칭되는 규칙이 있으면 JSON으로 응답: {"ruleId": "규칙ID", "confidence": 0.0~1.0}
매칭되는 규칙이 없으면: {"ruleId": null, "confidence": 0}
JSON만 출력하세요.

규칙 목록:
${rulesDescription}`,
      messages: [
        { role: 'user', content: customerMessage },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    if (!parsed.ruleId || parsed.confidence < MATCH_CONFIDENCE_THRESHOLD) {
      return null;
    }

    const matchedRule = rules.find((r) => r.id === parsed.ruleId);
    if (!matchedRule) return null;

    return { rule: matchedRule, confidence: parsed.confidence };
  } catch (error) {
    console.error('[LearningService] matchRule error:', error);
    return null;
  }
}

// 규칙 템플릿 기반으로 고객 메시지에 맞는 응답 생성
export async function generateAutoResponse(
  rule: AutoRule,
  customerMessage: string
): Promise<string> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      temperature: 0.3,
      system: `아래 템플릿 응답을 기반으로 고객의 구체적 질문에 맞게 자연스럽게 변형하세요.
템플릿의 핵심 내용과 톤을 유지하되, 고객 질문에 맞게 약간 조정하세요.
마크다운 문법을 사용하지 마세요. Instagram DM에 맞는 친근한 톤으로 작성하세요.
응답 텍스트만 출력하세요.

카테고리: ${rule.category}
템플릿 응답: ${rule.template_response}`,
      messages: [
        { role: 'user', content: customerMessage },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    return text || rule.template_response;
  } catch (error) {
    console.error('[LearningService] generateAutoResponse error:', error);
    return rule.template_response;
  }
}

// 계정별 승인된 규칙 캐시 조회 (2분 TTL)
async function getApprovedRules(accountId: string): Promise<AutoRule[]> {
  const now = Date.now();
  const cached = ruleCache.get(accountId);
  if (cached && now - cached.timestamp < RULE_CACHE_TTL_MS) {
    return cached.rules;
  }

  const { data } = await supabase
    .from('saju_cs_auto_rules')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'approved');

  const rules = (data as AutoRule[]) || [];
  ruleCache.set(accountId, { rules, timestamp: now });
  return rules;
}

// 캐시 무효화 (규칙 상태 변경 시 호출)
export function invalidateRuleCache(accountId?: string): void {
  if (accountId) {
    ruleCache.delete(accountId);
  } else {
    ruleCache.clear();
  }
}
