import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { webhookHandler } from '../services/webhookHandler';
import type { InstagramWebhookBody } from '@/app/lib/types';

// Meta Webhook 검증 (구독 확인)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const expectedToken = process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === expectedToken) {
    console.log('[Webhook] Verification successful');
    return new NextResponse(challenge, { status: 200 });
  }

  console.warn('[Webhook] Verification failed', { mode });
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

// Instagram DM 이벤트 수신
export async function POST(request: NextRequest) {
  const body: InstagramWebhookBody = await request.json();

  // Meta에 즉시 200 반환 (20초 내 응답 필수)
  // 실제 처리는 비동기로 진행
  if (body.object === 'instagram') {
    const processingPromise = webhookHandler.handle(body).catch((error) => {
      console.error('[Webhook] Processing error:', error);
    });
    waitUntil(processingPromise);
  }

  return NextResponse.json({ status: 'ok' });
}
