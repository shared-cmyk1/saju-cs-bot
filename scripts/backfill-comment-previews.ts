import { readFileSync } from "fs";
import { resolve } from "path";

// .env.local 파싱
const envPath = resolve(process.cwd(), ".env.local");
const envContent = readFileSync(envPath, "utf-8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
  if (!process.env[key]) process.env[key] = val;
}

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);
const anthropic = new Anthropic();

// 계정별 댓글 미리보기 goodsTypes
const ACCOUNT_GOODS_TYPES: Record<string, string[]> = {
  saju_maeul: ["ADULT"],
  unse_jeojangso: ["ROMANTIC"],
};

interface IGComment {
  id: string;
  text: string;
  username: string;
  timestamp: string;
  from?: { id: string; username: string };
}

interface IGMedia {
  id: string;
  caption?: string;
  timestamp: string;
}

// Instagram API: 최근 미디어 조회
async function getRecentMedia(igAccountId: string, token: string): Promise<IGMedia[]> {
  const url = `https://graph.instagram.com/v21.0/${igAccountId}/media?fields=id,caption,timestamp&limit=50`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    console.error("미디어 조회 실패:", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return data.data || [];
}

// Instagram API: 미디어의 댓글 조회
async function getComments(mediaId: string, token: string): Promise<IGComment[]> {
  const allComments: IGComment[] = [];
  let url: string | null = `https://graph.instagram.com/v21.0/${mediaId}/comments?fields=id,text,username,timestamp,from&limit=100`;

  while (url) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      console.error(`  댓글 조회 실패 (media ${mediaId}):`, res.status, await res.text());
      break;
    }
    const data = await res.json();
    allComments.push(...(data.data || []));
    url = data.paging?.next || null;
  }

  return allComments;
}

// 생년월일 추출
async function extractBirthdate(text: string): Promise<{
  hasBirthdate: boolean;
  birthdate?: string;
  birthTime?: string;
  gender?: string;
}> {
  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      temperature: 0,
      system: `Instagram 댓글에서 생년월일 정보를 추출하세요.
사주/운세 관련 게시물의 댓글이므로, 사람들이 자기 생년월일을 적는 경우가 많습니다.
다양한 형식 인식: "950302", "95.03.02", "95년 3월 2일", "01.08.07", "19890502양력" 등
6자리 숫자는 YYMMDD로, 8자리 숫자는 YYYYMMDD로 해석하세요.
반드시 JSON만 응답: {"hasBirthdate":true,"birthdate":"YYYYMMDD","birthTime":null,"gender":null}
생년월일이 없으면: {"hasBirthdate":false}`,
      messages: [{ role: "user", content: text }],
    });

    const aiText = response.content[0].type === "text" ? response.content[0].text : "";
    return JSON.parse(aiText.replace(/```json?\n?/g, "").replace(/```/g, "").trim());
  } catch {
    return { hasBirthdate: false };
  }
}

// Private Reply DM 발송
async function sendPrivateReply(commentId: string, message: string, token: string): Promise<boolean> {
  const res = await fetch("https://graph.instagram.com/v21.0/me/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      recipient: { comment_id: commentId },
      message: { text: message },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    // 24시간/7일 제한 등으로 실패
    if (err.includes("Cannot send message") || err.includes("outside the allowed window")) {
      return false; // 시간 초과 - 패스
    }
    throw new Error(`DM 실패 ${res.status}: ${err}`);
  }
  return true;
}

// 미리보기 생성
async function createPreview(
  params: { name: string; gender: string; birthdate: string; birthTime: string; goodsTypes: string[] },
  apiUrl: string,
  apiKey: string
) {
  const res = await fetch(`${apiUrl}/api/external/preview`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`Preview API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function processAccount(slug: string) {
  const { data: account } = await supabase
    .from("saju_cs_accounts")
    .select("*")
    .eq("slug", slug)
    .single();

  if (!account) {
    console.error(`${slug} 계정 없음`);
    return;
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`${account.display_name} (${slug})`);
  console.log(`${"=".repeat(50)}`);

  if (!account.instagram_access_token || !account.report_api_url || !account.report_api_key) {
    console.error("  API 설정 부족, 스킵");
    return;
  }

  const goodsTypes = ACCOUNT_GOODS_TYPES[slug] || ["ROMANTIC"];
  console.log(`  goodsTypes: ${goodsTypes.join(", ")}`);

  // 1. 미디어 조회
  const media = await getRecentMedia(account.instagram_business_account_id, account.instagram_access_token);
  console.log(`  미디어: ${media.length}개`);

  let totalComments = 0;
  let extracted = 0;
  let sent = 0;
  let skippedWindow = 0;
  let skippedDup = 0;
  let failed = 0;

  for (const m of media) {
    const comments = await getComments(m.id, account.instagram_access_token);
    if (comments.length === 0) continue;

    console.log(`\n  [미디어 ${m.id}] 댓글 ${comments.length}개 | ${m.caption?.substring(0, 40) || "(no caption)"}...`);
    totalComments += comments.length;

    for (const comment of comments) {
      // DB 중복 체크
      const { data: existing } = await supabase
        .from("saju_cs_comment_reports")
        .select("id")
        .eq("comment_id", comment.id)
        .maybeSingle();

      if (existing) {
        skippedDup++;
        continue;
      }

      // 생년월일 추출
      const extraction = await extractBirthdate(comment.text);

      if (!extraction.hasBirthdate || !extraction.birthdate) {
        // 생년월일 없는 댓글 기록
        await supabase.from("saju_cs_comment_reports").insert({
          account_id: account.id,
          comment_id: comment.id,
          media_id: m.id,
          instagram_user_id: comment.from?.id || null,
          instagram_username: comment.username,
          comment_text: comment.text,
          preview_sent: false,
          error: null,
        });
        continue;
      }

      extracted++;

      try {
        // 미리보기 생성
        const preview = await createPreview(
          {
            name: comment.username || "고객",
            gender: extraction.gender || "여",
            birthdate: extraction.birthdate,
            birthTime: extraction.birthTime || "모름",
            goodsTypes,
          },
          account.report_api_url,
          account.report_api_key
        );

        if (!preview.success || !preview.previews?.length) {
          throw new Error("Preview API returned no results");
        }

        const previewLinks = preview.previews
          .map((p: { title: string; previewUrl: string }) => `${p.title}: ${p.previewUrl}`)
          .join("\n");

        const dmMessage = `안녕하세요${comment.username ? ` @${comment.username}` : ""}님! 🔮

${account.display_name} 보고서 미리보기 링크를 전달드립니다!

${previewLinks}

링크를 눌러 나만의 사주 결과를 확인해보세요 ✨`;

        // Private Reply DM
        const dmSent = await sendPrivateReply(comment.id, dmMessage, account.instagram_access_token);

        if (!dmSent) {
          // 시간 초과로 DM 불가
          await supabase.from("saju_cs_comment_reports").insert({
            account_id: account.id,
            comment_id: comment.id,
            media_id: m.id,
            instagram_user_id: comment.from?.id || null,
            instagram_username: comment.username,
            comment_text: comment.text,
            birthdate: extraction.birthdate,
            birth_time: extraction.birthTime || null,
            preview_sent: false,
            error: "DM window expired",
          });
          skippedWindow++;
          console.log(`    ⏭ ${comment.username} (${extraction.birthdate}) → DM 기간 만료, 패스`);
          continue;
        }

        // 대댓글 (실패 무시)
        try {
          await fetch(`https://graph.instagram.com/v21.0/${comment.id}/replies`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${account.instagram_access_token}`,
            },
            body: JSON.stringify({ message: "✨ 미리보기를 DM으로 전송드렸습니다! 확인해주세요 💌" }),
          });
        } catch { /* ignore */ }

        // DB 기록
        await supabase.from("saju_cs_comment_reports").insert({
          account_id: account.id,
          comment_id: comment.id,
          media_id: m.id,
          instagram_user_id: comment.from?.id || null,
          instagram_username: comment.username,
          comment_text: comment.text,
          birthdate: extraction.birthdate,
          birth_time: extraction.birthTime || null,
          preview_sent: true,
          dm_message: dmMessage,
        });

        sent++;
        console.log(`    ✓ ${comment.username} (${extraction.birthdate}) → 미리보기 발송 완료`);
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await supabase.from("saju_cs_comment_reports").insert({
          account_id: account.id,
          comment_id: comment.id,
          media_id: m.id,
          instagram_user_id: comment.from?.id || null,
          instagram_username: comment.username,
          comment_text: comment.text,
          birthdate: extraction.birthdate,
          birth_time: extraction.birthTime || null,
          preview_sent: false,
          error: errMsg,
        });
        failed++;
        console.error(`    ✗ ${comment.username} (${extraction.birthdate}) → ${errMsg}`);
      }
    }
  }

  console.log(`\n  --- ${account.display_name} 결과 ---`);
  console.log(`  전체 댓글: ${totalComments}`);
  console.log(`  생년월일 추출: ${extracted}`);
  console.log(`  발송 성공: ${sent}`);
  console.log(`  기간 만료 패스: ${skippedWindow}`);
  console.log(`  중복 스킵: ${skippedDup}`);
  console.log(`  실패: ${failed}`);
}

async function main() {
  await processAccount("saju_maeul");
  await processAccount("unse_jeojangso");
  console.log("\n=== 전체 완료 ===");
}

main();
