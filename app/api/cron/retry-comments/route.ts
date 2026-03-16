import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from '@/app/api/instagram/services/graphApi';
import { createPreview } from '@/app/lib/report/reportApiClient';

const anthropic = new Anthropic();

// Vercel Cron으로 매시간 실행: 실패한 댓글 재추출 + 재발송
// GET /api/cron/retry-comments (Authorization: Bearer CRON_SECRET)
export async function GET(request: NextRequest) {
  // Vercel Cron 인증
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 활성 계정 조회
  const { data: accounts } = await supabase
    .from('saju_cs_accounts')
    .select('*')
    .eq('is_active', true);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: 'No active accounts' }, { status: 500 });
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  // Step 1: 생년월일이 null인 최근 댓글 재추출 (최근 24시간)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: needExtraction } = await supabase
    .from('saju_cs_comment_reports')
    .select('*')
    .eq('preview_sent', false)
    .is('birthdate', null)
    .not('comment_text', 'is', null)
    .gte('created_at', oneDayAgo)
    .limit(30);

  let extracted = 0;
  for (const comment of needExtraction || []) {
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        temperature: 0,
        system: `Instagram 댓글에서 생년월일 정보를 추출하세요.
다양한 형식 인식: "950302", "95.03.02", "95년 3월 2일" 등
6자리 숫자는 YYMMDD로 해석하세요.
반드시 JSON만 응답: {"hasBirthdate":true,"birthdate":"YYYYMMDD","birthTime":null,"gender":null}
생년월일이 없으면: {"hasBirthdate":false}`,
        messages: [{ role: 'user', content: comment.comment_text }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      if (parsed.hasBirthdate && parsed.birthdate) {
        await supabase
          .from('saju_cs_comment_reports')
          .update({ birthdate: parsed.birthdate, birth_time: parsed.birthTime || null, error: null })
          .eq('id', comment.id);
        extracted++;
      }
    } catch (error) {
      console.error('[Cron] Re-extraction failed:', comment.id, error);
    }
  }

  // Step 2: 생년월일 있고 preview 미발송 + 최근 24시간 댓글 재발송
  const { data: needSend } = await supabase
    .from('saju_cs_comment_reports')
    .select('*')
    .eq('preview_sent', false)
    .not('birthdate', 'is', null)
    .gte('created_at', oneDayAgo)
    .limit(30);

  let sent = 0;
  for (const comment of needSend || []) {
    const account = accountMap.get(comment.account_id);
    if (!account || !account.report_api_url || !account.report_api_key) continue;

    try {
      const commentGoodsTypes = (account.service_map as Record<string, unknown>)?.comment_goods_types as string[] | undefined
        || ['CLASSIC', 'ROMANTIC', 'SPICYSAJU'];

      const previewResult = await createPreview(
        {
          name: comment.instagram_username || '고객',
          birthdate: comment.birthdate,
          birthTime: comment.birth_time || undefined,
          goodsTypes: commentGoodsTypes,
        },
        account.report_api_url,
        account.report_api_key
      );

      if (!previewResult.success || previewResult.previews.length === 0) continue;

      const previewLinks = previewResult.previews
        .map((p) => `${p.title}: ${p.previewUrl}`)
        .join('\n');

      const dmMessage = `안녕하세요${comment.instagram_username ? ` @${comment.instagram_username}` : ''}님! 🔮\n\n${account.display_name} 보고서 미리보기 링크를 전달드립니다!\n\n${previewLinks}\n\n링크를 눌러 나만의 사주 결과를 확인해보세요 ✨`;

      await graphApi.sendPrivateReply(comment.comment_id, dmMessage, account.instagram_access_token);

      try {
        await graphApi.replyToComment(
          comment.comment_id,
          `✨ 미리보기를 DM으로 전송드렸습니다! 확인해주세요 💌`,
          account.instagram_access_token
        );
      } catch {
        // 대댓글 실패는 무시
      }

      await supabase
        .from('saju_cs_comment_reports')
        .update({ preview_sent: true, dm_message: dmMessage, error: null })
        .eq('id', comment.id);

      sent++;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await supabase
        .from('saju_cs_comment_reports')
        .update({ error: errMsg })
        .eq('id', comment.id);
      console.error('[Cron] Retry send failed:', comment.id, errMsg);
    }
  }

  console.log(`[Cron] retry-comments: extracted=${extracted}, sent=${sent}`);

  return NextResponse.json({
    extracted,
    sent,
    needExtraction: needExtraction?.length || 0,
    needSend: needSend?.length || 0,
  });
}
