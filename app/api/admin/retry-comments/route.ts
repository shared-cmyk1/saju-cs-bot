import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from '@/app/api/instagram/services/graphApi';
import { createPreview } from '@/app/lib/report/reportApiClient';
import type { AccountConfig } from '@/app/lib/types';

// 실패한 댓글들 재발송 (일회성 관리용)
// GET /api/admin/retry-comments?token=WEBHOOK_VERIFY_TOKEN
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (token !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 사주로그 계정 조회
  const { data: account } = await supabase
    .from('saju_cs_accounts')
    .select('*')
    .eq('slug', 'saju_log')
    .single();

  if (!account || !account.report_api_url || !account.report_api_key) {
    return NextResponse.json({ error: 'Account not found or missing API config' }, { status: 500 });
  }

  // 실패한 댓글 조회 (생년월일 있고, preview 미발송)
  const { data: failedComments } = await supabase
    .from('saju_cs_comment_reports')
    .select('*')
    .eq('account_id', account.id)
    .eq('preview_sent', false)
    .not('birthdate', 'is', null);

  if (!failedComments || failedComments.length === 0) {
    return NextResponse.json({ message: 'No failed comments to retry', count: 0 });
  }

  const commentGoodsTypes = (account.service_map as Record<string, unknown>)?.comment_goods_types as string[] | undefined
    || ['CLASSIC', 'ROMANTIC', 'SPICYSAJU'];

  const results: Array<{ comment_id: string; success: boolean; error?: string }> = [];

  for (const comment of failedComments) {
    try {
      const previewResult = await createPreview(
        {
          name: comment.instagram_username || '고객',
          gender: undefined,
          birthdate: comment.birthdate,
          birthTime: comment.birth_time || undefined,
          goodsTypes: commentGoodsTypes,
        },
        account.report_api_url,
        account.report_api_key
      );

      if (!previewResult.success || previewResult.previews.length === 0) {
        results.push({ comment_id: comment.comment_id, success: false, error: 'No previews returned' });
        continue;
      }

      const previewLinks = previewResult.previews
        .map((p) => `${p.title}: ${p.previewUrl}`)
        .join('\n');

      const dmMessage = `안녕하세요${comment.instagram_username ? ` @${comment.instagram_username}` : ''}님! 🔮

${account.display_name} 보고서 미리보기 링크를 전달드립니다!

${previewLinks}

링크를 눌러 나만의 사주 결과를 확인해보세요 ✨`;

      // Private Reply로 DM 발송
      await graphApi.sendPrivateReply(comment.comment_id, dmMessage, account.instagram_access_token);

      // 대댓글
      try {
        await graphApi.replyToComment(
          comment.comment_id,
          `✨ 미리보기를 DM으로 전송드렸습니다! 확인해주세요 💌`,
          account.instagram_access_token
        );
      } catch {
        // 대댓글 실패는 무시
      }

      // DB 업데이트
      await supabase
        .from('saju_cs_comment_reports')
        .update({ preview_sent: true, dm_message: dmMessage, error: null })
        .eq('id', comment.id);

      results.push({ comment_id: comment.comment_id, success: true });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Unknown error';
      await supabase
        .from('saju_cs_comment_reports')
        .update({ error: errMsg })
        .eq('id', comment.id);
      results.push({ comment_id: comment.comment_id, success: false, error: errMsg });
    }
  }

  return NextResponse.json({
    total: failedComments.length,
    success: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results,
  });
}
