import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, boolean> = {
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    instagram: !!process.env.INSTAGRAM_USER_ACCESS_TOKEN,
    slack: !!process.env.SLACK_BOT_TOKEN,
  };

  const allHealthy = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: allHealthy ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: allHealthy ? 200 : 503 }
  );
}
