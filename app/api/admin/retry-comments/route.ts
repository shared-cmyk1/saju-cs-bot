import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from '@/app/api/instagram/services/graphApi';
import { createPreview } from '@/app/lib/report/reportApiClient';
import type { AccountConfig } from '@/app/lib/types';

const anthropic = new Anthropic();

// 실패한 댓글들 재발송 (일회성 관리용)
// GET /api/admin/retry-comments?token=WEBHOOK_VERIFY_TOKEN
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (token !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 활성 계정 전체 조회
  const { data: accounts } = await supabase
    .from('saju_cs_accounts')
    .select('*')
    .eq('is_active', true);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: 'No active accounts' }, { status: 500 });
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  // 실패한 댓글 조회 (생년월일 있고, preview 미발송)
  const { data: failedComments } = await supabase
    .from('saju_cs_comment_reports')
    .select('*')
    .eq('preview_sent', false)
    .not('birthdate', 'is', null);

  if (!failedComments || failedComments.length === 0) {
    return NextResponse.json({ message: 'No failed comments to retry', count: 0 });
  }

  const results: Array<{ comment_id: string; success: boolean; error?: string }> = [];

  for (const comment of failedComments) {
    const account = accountMap.get(comment.account_id);
    if (!account || !account.report_api_url || !account.report_api_key) {
      results.push({ comment_id: comment.comment_id, success: false, error: 'Account missing API config' });
      continue;
    }

    const commentGoodsTypes = (account.service_map as Record<string, unknown>)?.comment_goods_types as string[] | undefined
      || ['CLASSIC', 'ROMANTIC', 'SPICYSAJU'];

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

// 생년월일 재추출 + 발송 (birthdate가 null인 실패 건)
// POST /api/admin/retry-comments?token=WEBHOOK_VERIFY_TOKEN
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (token !== process.env.WEBHOOK_VERIFY_TOKEN) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 활성 계정 전체 조회
  const { data: accounts } = await supabase
    .from('saju_cs_accounts')
    .select('*')
    .eq('is_active', true);

  if (!accounts || accounts.length === 0) {
    return NextResponse.json({ error: 'No active accounts' }, { status: 500 });
  }

  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  // 생년월일이 null이고 preview 미발송인 댓글 조회
  const { data: failedComments } = await supabase
    .from('saju_cs_comment_reports')
    .select('*')
    .eq('preview_sent', false)
    .is('birthdate', null)
    .not('comment_text', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100);

  if (!failedComments || failedComments.length === 0) {
    return NextResponse.json({ message: 'No comments need re-extraction', count: 0 });
  }

  const results: Array<{ id: string; comment_text: string; birthdate: string | null; error?: string }> = [];

  for (const comment of failedComments) {
    const account = accountMap.get(comment.account_id);
    if (!account || !account.report_api_url || !account.report_api_key) {
      results.push({ id: comment.id, comment_text: comment.comment_text, birthdate: null, error: 'Account missing API config' });
      continue;
    }

    try {
      // AI로 생년월일 재추출
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        temperature: 0,
        system: `Instagram 댓글에서 생년월일 정보를 추출하세요.
다양한 형식 인식: "950302", "95.03.02", "95년 3월 2일", "01.08.07" 등
6자리 숫자는 YYMMDD로 해석하세요.
반드시 JSON만 응답: {"hasBirthdate":true,"birthdate":"YYYYMMDD","birthTime":null,"gender":null}
생년월일이 없으면: {"hasBirthdate":false}`,
        messages: [{ role: 'user', content: comment.comment_text }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const parsed = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

      if (!parsed.hasBirthdate || !parsed.birthdate) {
        results.push({ id: comment.id, comment_text: comment.comment_text, birthdate: null, error: 'No birthdate in text' });
        continue;
      }

      // DB 업데이트: 생년월일 저장
      await supabase
        .from('saju_cs_comment_reports')
        .update({
          birthdate: parsed.birthdate,
          birth_time: parsed.birthTime || null,
          error: null,
        })
        .eq('id', comment.id);

      results.push({ id: comment.id, comment_text: comment.comment_text, birthdate: parsed.birthdate });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      await supabase
        .from('saju_cs_comment_reports')
        .update({ error: `re-extract failed: ${errMsg}` })
        .eq('id', comment.id);
      results.push({ id: comment.id, comment_text: comment.comment_text, birthdate: null, error: errMsg });
    }
  }

  const extracted = results.filter(r => r.birthdate);

  return NextResponse.json({
    total: failedComments.length,
    extracted: extracted.length,
    failed: results.length - extracted.length,
    results,
    next_step: extracted.length > 0 ? 'Run GET /api/admin/retry-comments to send previews' : null,
  });
}
