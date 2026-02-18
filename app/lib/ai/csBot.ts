import Anthropic from '@anthropic-ai/sdk';
import type { CSBotInput, CSBotOutput } from '@/app/lib/types';

const anthropic = new Anthropic();

function buildSystemPrompt(faqContent: string): string {
  return `당신은 AI 사주 서비스의 고객 상담 봇입니다.

## 역할
- Instagram DM을 통해 들어오는 고객 문의에 답변합니다.
- FAQ 문서를 기반으로 정확한 정보만 전달합니다.
- 답변할 수 없는 질문은 반드시 에스컬레이션합니다.

## FAQ 문서
아래는 자주 묻는 질문과 답변입니다. 이 내용을 기반으로 답변하세요.

---
${faqContent}
---

## 응답 규칙

1. **FAQ에 답이 있는 경우**: FAQ 내용을 바탕으로 친절하게 답변하세요. 원문을 그대로 복사하지 말고, 대화체로 자연스럽게 풀어서 설명하세요.

2. **FAQ에 답이 없는 경우**: 반드시 에스컬레이션하세요. 추측하거나 만들어내지 마세요.

3. **에스컬레이션 기준** (하나라도 해당하면 에스컬레이션):
   - 특정 주문/결제 건에 대한 조회 요청 (주문번호, 결제 확인 등)
   - FAQ에 없는 서비스 정책 질문
   - 불만/컴플레인 (환불 요구, 서비스 불만 등)
   - 기술적 오류 신고 (앱이 안 열려요, 결제가 안 돼요 등)
   - 사주/운세에 대한 구체적 해석 질문 (AI가 직접 사주를 봐주는 것이 아님)
   - 확신이 없는 모든 경우

4. **톤**: 친근하고 따뜻한 ~해요 체. 이모지 적절히 사용. Instagram DM에 맞는 짧고 간결한 문장.

5. **금지 사항**:
   - 사주/운세를 직접 봐주지 마세요. 서비스 이용 방법만 안내하세요.
   - 가격을 임의로 말하지 마세요. FAQ에 없으면 에스컬레이션하세요.
   - 마크다운 문법(**, ##, - 등)을 사용하지 마세요. 순수 텍스트로만 답변하세요.

## 출력 형식

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트를 추가하지 마세요.

{
  "action": "respond" 또는 "escalate",
  "answer": "고객에게 보낼 답변 (action이 respond일 때)",
  "suggestedAnswer": "팀 참고용 추천 답변 (action이 escalate일 때, 없으면 null)",
  "matchedFAQ": "매칭된 FAQ 질문 (없으면 null)",
  "reasoning": "판단 근거 (내부 로그용)"
}`;
}

export async function generateResponse(input: CSBotInput): Promise<CSBotOutput> {
  const systemPrompt = buildSystemPrompt(input.faqContent);

  // 대화 이력을 Claude 메시지 형식으로 변환
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const msg of input.conversationHistory) {
    const role = msg.role === 'user' ? 'user' : 'assistant';
    // Claude API는 같은 role이 연속되면 안 되므로 병합
    if (messages.length > 0 && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + msg.content;
    } else {
      messages.push({ role, content: msg.content });
    }
  }

  // 현재 메시지 추가
  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    messages[messages.length - 1].content += '\n' + input.currentMessage;
  } else {
    messages.push({ role: 'user', content: input.currentMessage });
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0.3,
      system: systemPrompt,
      messages,
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // JSON 파싱 (코드블록으로 감싸져 있을 수 있음)
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    return {
      shouldEscalate: parsed.action === 'escalate',
      answer: parsed.answer || '',
      suggestedAnswer: parsed.suggestedAnswer || undefined,
      matchedFAQ: parsed.matchedFAQ || undefined,
      reasoning: parsed.reasoning || undefined,
    };
  } catch (error) {
    console.error('[CSBot] AI response error:', error);
    // AI 실패 시 안전하게 에스컬레이션
    return {
      shouldEscalate: true,
      answer: '',
      suggestedAnswer: undefined,
      reasoning: 'AI response failed, escalating to team',
    };
  }
}
