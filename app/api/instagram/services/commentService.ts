import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from './graphApi';
import { createPreview } from '@/app/lib/report/reportApiClient';
import type { InstagramCommentEvent, AccountConfig } from '@/app/lib/types';

const anthropic = new Anthropic();

interface BirthdateExtraction {
  hasBirthdate: boolean;
  birthdate?: string; // YYYYMMDD
  birthTime?: string; // HH:mm or '모름'
  gender?: string;    // 남 or 여
}

// 댓글에서 생년월일 추출
async function extractBirthdateFromComment(
  commentText: string
): Promise<BirthdateExtraction> {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      temperature: 0,
      system: `Instagram 댓글에서 생년월일 정보를 추출하세요.
사주/운세 관련 게시물의 댓글이므로, 사람들이 자기 생년월일을 적는 경우가 많습니다.

다양한 형식을 인식하세요:
- "95년 3월 2일", "1995.03.02", "95/03/02", "95년생", "950302"
- "95년 3월 2일 오후 2시", "새벽 3시 태어남"
- "여자 95.03.02", "남 1995년 3월 2일생"

반드시 아래 JSON 형식으로만 응답하세요:
{
  "hasBirthdate": true 또는 false,
  "birthdate": "YYYYMMDD 형식 (없으면 null)",
  "birthTime": "HH:mm 형식 (없으면 null, 모르면 null)",
  "gender": "남" 또는 "여" (없으면 null)
}

생년월일이 없는 일반 댓글이면 hasBirthdate: false로 응답하세요.
JSON만 출력하세요.`,
      messages: [{ role: 'user', content: commentText }],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonStr = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr) as BirthdateExtraction;
  } catch (error) {
    console.error('[CommentService] extractBirthdate error:', error);
    return { hasBirthdate: false };
  }
}

// 댓글 처리 메인 로직
export async function handleComment(
  comment: InstagramCommentEvent['value'],
  account: AccountConfig
): Promise<void> {
  const commentId = comment.id;
  const userId = comment.from.id;
  const username = comment.from.username;
  const commentText = comment.text;

  // 미리보기 API 설정 없는 계정은 스킵
  if (!account.report_api_url || !account.report_api_key) {
    return;
  }

  // 대댓글은 무시 (parent_id가 있으면 대댓글)
  if (comment.parent_id) return;

  // 중복 체크
  const { data: existing } = await supabase
    .from('saju_cs_comment_reports')
    .select('id')
    .eq('comment_id', commentId)
    .maybeSingle();

  if (existing) {
    console.log('[CommentService] Duplicate comment, skipping:', commentId);
    return;
  }

  // 생년월일 추출
  const extraction = await extractBirthdateFromComment(commentText);

  if (!extraction.hasBirthdate || !extraction.birthdate) {
    // 생년월일 없는 댓글 → 기록만 하고 종료
    await supabase.from('saju_cs_comment_reports').insert({
      account_id: account.id,
      comment_id: commentId,
      media_id: comment.media.id,
      instagram_user_id: userId,
      instagram_username: username || null,
      comment_text: commentText,
      preview_sent: false,
    });
    console.log('[CommentService] No birthdate found in comment:', commentId);
    return;
  }

  // 미리보기 API 호출 (이름은 인스타 닉네임, REUNION 제외)
  try {
    // 계정별 댓글 미리보기 goodsTypes 설정
    // service_map에 comment_goods_types가 있으면 사용, 없으면 기본값
    const commentGoodsTypes = (account.service_map as Record<string, unknown>)?.comment_goods_types as string[] | undefined
      || ['CLASSIC', 'ROMANTIC', 'SPICYSAJU'];

    const previewResult = await createPreview(
      {
        name: username || '고객',
        gender: extraction.gender || undefined,
        birthdate: extraction.birthdate,
        birthTime: extraction.birthTime || undefined,
        goodsTypes: commentGoodsTypes,
      },
      account.report_api_url,
      account.report_api_key
    );

    if (!previewResult.success || previewResult.previews.length === 0) {
      await supabase.from('saju_cs_comment_reports').insert({
        account_id: account.id,
        comment_id: commentId,
        media_id: comment.media.id,
        instagram_user_id: userId,
        instagram_username: username || null,
        comment_text: commentText,
        birthdate: extraction.birthdate,
        birth_time: extraction.birthTime || null,
        preview_sent: false,
        error: 'Preview API returned no results',
      });
      return;
    }

    // DM 메시지 구성
    const previewLinks = previewResult.previews
      .map((p) => `${p.title}: ${p.previewUrl}`)
      .join('\n');

    const dmMessage = `안녕하세요${username ? ` @${username}` : ''}님! 🔮

${account.display_name} 보고서 미리보기 링크를 전달드립니다!

${previewLinks}

링크를 눌러 나만의 사주 결과를 확인해보세요 ✨`;

    // DM 발송
    await graphApi.sendMessage(userId, dmMessage, account.instagram_access_token);

    // 댓글에 대댓글 달기
    try {
      await graphApi.replyToComment(
        commentId,
        `✨ 미리보기를 DM으로 전송드렸습니다! 확인해주세요 💌`,
        account.instagram_access_token
      );
    } catch (replyError) {
      console.error('[CommentService] Reply to comment failed:', replyError);
    }

    // 성공 기록
    await supabase.from('saju_cs_comment_reports').insert({
      account_id: account.id,
      comment_id: commentId,
      media_id: comment.media.id,
      instagram_user_id: userId,
      instagram_username: username || null,
      comment_text: commentText,
      birthdate: extraction.birthdate,
      birth_time: extraction.birthTime || null,
      preview_sent: true,
      dm_message: dmMessage,
    });

    console.log('[CommentService] Preview DM sent:', {
      commentId,
      userId,
      birthdate: extraction.birthdate,
      previewCount: previewResult.previews.length,
    });
  } catch (error) {
    console.error('[CommentService] Preview/DM failed:', error);

    await supabase.from('saju_cs_comment_reports').insert({
      account_id: account.id,
      comment_id: commentId,
      media_id: comment.media.id,
      instagram_user_id: userId,
      instagram_username: username || null,
      comment_text: commentText,
      birthdate: extraction.birthdate,
      birth_time: extraction.birthTime || null,
      preview_sent: false,
      error: error instanceof Error ? error.message : 'Preview/DM failed',
    });
  }
}
