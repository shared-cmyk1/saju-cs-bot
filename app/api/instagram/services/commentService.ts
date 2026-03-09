import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/app/lib/supabase/client';
import * as graphApi from './graphApi';
import type { InstagramCommentEvent, AccountConfig } from '@/app/lib/types';

const anthropic = new Anthropic();

interface BirthdateExtraction {
  hasBirthdate: boolean;
  birthdate?: string; // YYYYMMDD
  birthTime?: string; // HH:mm or '모름'
  gender?: string;    // 남 or 여
  name?: string;
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
  "gender": "남" 또는 "여" (없으면 null),
  "name": "이름 (없으면 null)"
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

// 사주 미리보기 생성 (Claude로 간단한 운세 티저)
async function generatePreview(
  birthdate: string,
  birthTime?: string,
  gender?: string
): Promise<string> {
  const birthTimeStr = birthTime && birthTime !== '모름' ? birthTime : null;
  const genderStr = gender === '남' ? '남성' : gender === '여' ? '여성' : null;

  const userInfo = [
    `생년월일: ${birthdate.slice(0, 4)}년 ${parseInt(birthdate.slice(4, 6))}월 ${parseInt(birthdate.slice(6, 8))}일`,
    birthTimeStr ? `태어난 시간: ${birthTimeStr}` : null,
    genderStr ? `성별: ${genderStr}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      temperature: 0.7,
      system: `당신은 사주로그의 사주 미리보기 생성 봇입니다.
사주명리학 기초를 바탕으로 생년월일에 맞는 간단한 운세 미리보기를 작성하세요.

## 규칙
- 3~4줄 정도의 짧은 미리보기 (Instagram DM에 적합하게)
- 사주팔자의 일간(日干), 월지(月支)를 기반으로 가벼운 성격/운세 힌트
- 긍정적이고 흥미를 유발하는 톤
- 마크다운 사용하지 않기
- "더 자세한 내용이 궁금하시면 사주로그에서 확인해보세요!" 같은 CTA는 포함하지 마세요 (별도로 붙입니다)
- 순수 텍스트만 출력하세요`,
      messages: [
        {
          role: 'user',
          content: `아래 정보로 사주 미리보기를 작성해주세요:\n${userInfo}`,
        },
      ],
    });

    const text =
      response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    return text;
  } catch (error) {
    console.error('[CommentService] generatePreview error:', error);
    return '';
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

  // 미리보기 생성
  const preview = await generatePreview(
    extraction.birthdate,
    extraction.birthTime || undefined,
    extraction.gender || undefined
  );

  if (!preview) {
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
      error: 'Preview generation failed',
    });
    return;
  }

  // DM 메시지 구성
  const dmMessage = `안녕하세요${username ? ` @${username}` : ''}님! 😊
댓글에 남겨주신 생년월일로 간단한 사주 미리보기를 준비했어요 ✨

${preview}

더 자세하고 깊이 있는 분석이 궁금하시다면, 프로필 링크에서 확인해보세요! 🔮`;

  try {
    // DM 발송
    await graphApi.sendMessage(userId, dmMessage, account.instagram_access_token);

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
    });
  } catch (error) {
    console.error('[CommentService] DM send failed:', error);

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
      error: error instanceof Error ? error.message : 'DM send failed',
    });
  }
}
