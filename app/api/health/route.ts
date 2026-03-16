import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export async function GET(request: NextRequest) {
  const checks: Record<string, boolean> = {
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    instagram: !!process.env.INSTAGRAM_USER_ACCESS_TOKEN,
    slack: !!process.env.SLACK_BOT_TOKEN,
    webhookToken: !!process.env.WEBHOOK_VERIFY_TOKEN,
  };

  const allHealthy = Object.values(checks).every(Boolean);

  // ?test=haiku 파라미터로 AI 호출 테스트
  const testMode = request.nextUrl.searchParams.get('test');
  let aiTest = null;

  if (testMode === 'haiku') {
    try {
      const anthropic = new Anthropic();
      const start = Date.now();
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        temperature: 0,
        system: 'JSON만 출력: {"name":"이름","gender":"성별","birthdate":"YYYYMMDD","birthTime":"HH:mm"}',
        messages: [{ role: 'user', content: '양연주 여자 02년 8월 6일 오전 11시 3분' }],
      });
      const elapsed = Date.now() - start;
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      aiTest = { success: true, response: text, elapsed_ms: elapsed };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      aiTest = { success: false, error: errMsg };
    }
  }

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      checks,
      aiTest,
      timestamp: new Date().toISOString(),
    },
    { status: allHealthy ? 200 : 503 }
  );
}
