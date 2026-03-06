import { NextRequest, NextResponse } from 'next/server';
import * as graphApi from '@/app/api/instagram/services/graphApi';
import { checkReportStatus } from '@/app/lib/report/reportApiClient';
import {
  getGeneratingSessions,
  markSessionCompleted,
  markSessionFailed,
  incrementPollCount,
  expireOldSessions,
  MESSAGES,
} from '@/app/lib/report/reportService';

const MAX_POLL_COUNT = 30; // 30분 (1분 간격)

export async function GET(request: NextRequest) {
  // Vercel Cron 인증
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. 만료된 세션 정리
    await expireOldSessions();

    // 2. 생성 중인 세션 폴링
    const sessions = await getGeneratingSessions();

    let completed = 0;
    let failed = 0;
    let pending = 0;

    for (const session of sessions) {
      try {
        // 최대 폴링 횟수 초과 → 실패 처리
        if (session.poll_count >= MAX_POLL_COUNT) {
          await markSessionFailed(session.id);
          await graphApi.sendMessage(
            session.instagram_user_id,
            MESSAGES.failed
          );
          failed++;
          continue;
        }

        await incrementPollCount(session.id);

        const status = await checkReportStatus(session.shop_order_no!);

        if (status.status === 'DONE' && status.reportUrl) {
          await markSessionCompleted(session.id, status.reportUrl);
          await graphApi.sendMessage(
            session.instagram_user_id,
            MESSAGES.completed(status.reportUrl)
          );
          completed++;
        } else if (status.status === 'ERROR') {
          await markSessionFailed(session.id);
          await graphApi.sendMessage(
            session.instagram_user_id,
            MESSAGES.failed
          );
          failed++;
        } else {
          pending++;
        }
      } catch (error) {
        console.error(
          `[ReportPoll] Error polling session ${session.id}:`,
          error
        );
        pending++;
      }
    }

    return NextResponse.json({
      ok: true,
      processed: sessions.length,
      completed,
      failed,
      pending,
    });
  } catch (error) {
    console.error('[ReportPoll] Cron error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
