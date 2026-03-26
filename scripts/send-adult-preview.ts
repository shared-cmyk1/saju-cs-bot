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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

async function main() {
  // 1. 사주마을 계정 조회
  const { data: account, error: accErr } = await supabase
    .from("saju_cs_accounts")
    .select("*")
    .eq("slug", "saju_maeul")
    .single();

  if (accErr || !account) {
    console.error("사주마을 계정 조회 실패:", accErr);
    process.exit(1);
  }

  console.log("=== 사주마을 계정 ===");
  console.log("  id:", account.id);
  console.log("  display_name:", account.display_name);
  console.log("  report_api_url:", account.report_api_url || "(없음)");
  console.log("  report_api_key:", account.report_api_key ? "***설정됨***" : "(없음)");
  console.log("  instagram_access_token:", account.instagram_access_token ? "***설정됨***" : "(없음)");
  console.log("  service_map:", JSON.stringify(account.service_map));

  if (!account.report_api_url || !account.report_api_key) {
    console.error("\n❌ 사주마을 계정에 report_api_url / report_api_key가 설정되지 않았습니다.");
    process.exit(1);
  }

  if (!account.instagram_access_token) {
    console.error("\n❌ 사주마을 계정에 instagram_access_token이 설정되지 않았습니다.");
    process.exit(1);
  }

  // 2. 미발송 댓글 조회 (birthdate 있고 preview_sent=false)
  const { data: comments, error: cmtErr } = await supabase
    .from("saju_cs_comment_reports")
    .select("*")
    .eq("account_id", account.id)
    .eq("preview_sent", false)
    .not("birthdate", "is", null)
    .order("created_at", { ascending: false });

  if (cmtErr) {
    console.error("댓글 조회 실패:", cmtErr);
    process.exit(1);
  }

  console.log(`\n=== 미발송 댓글: ${comments?.length || 0}건 ===`);

  if (!comments || comments.length === 0) {
    console.log("발송할 댓글이 없습니다.");
    process.exit(0);
  }

  for (const c of comments) {
    console.log(`  - ${c.instagram_username || c.instagram_user_id} | ${c.birthdate} | ${c.birth_time || "모름"} | "${c.comment_text?.substring(0, 40)}"`);
  }

  // 3. 미리보기 생성 + DM 발송
  console.log("\n=== ADULT 미리보기 발송 시작 ===");
  let successCount = 0;
  let failCount = 0;

  for (const comment of comments) {
    const username = comment.instagram_username || "고객";
    try {
      // Preview API 호출
      const previewRes = await fetch(`${account.report_api_url}/api/external/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": account.report_api_key,
        },
        body: JSON.stringify({
          name: username,
          gender: "여",
          birthdate: comment.birthdate,
          birthTime: comment.birth_time || "모름",
          goodsTypes: ["ADULT"],
        }),
      });

      if (!previewRes.ok) {
        const errText = await previewRes.text();
        throw new Error(`Preview API ${previewRes.status}: ${errText}`);
      }

      const previewData = await previewRes.json();

      if (!previewData.success || !previewData.previews?.length) {
        throw new Error("Preview API returned no results");
      }

      const previewLinks = previewData.previews
        .map((p: { title: string; previewUrl: string }) => `${p.title}: ${p.previewUrl}`)
        .join("\n");

      const dmMessage = `안녕하세요${comment.instagram_username ? ` @${comment.instagram_username}` : ""}님! 🔮

${account.display_name} 보고서 미리보기 링크를 전달드립니다!

${previewLinks}

링크를 눌러 나만의 사주 결과를 확인해보세요 ✨`;

      // Private Reply로 DM 발송
      const dmRes = await fetch(
        `https://graph.instagram.com/v21.0/me/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${account.instagram_access_token}`,
          },
          body: JSON.stringify({
            recipient: { comment_id: comment.comment_id },
            message: { text: dmMessage },
          }),
        }
      );

      if (!dmRes.ok) {
        const dmErr = await dmRes.text();
        throw new Error(`DM send failed ${dmRes.status}: ${dmErr}`);
      }

      // 대댓글 달기 (실패해도 무시)
      try {
        await fetch(
          `https://graph.instagram.com/v21.0/${comment.comment_id}/replies`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${account.instagram_access_token}`,
            },
            body: JSON.stringify({
              message: "✨ 미리보기를 DM으로 전송드렸습니다! 확인해주세요 💌",
            }),
          }
        );
      } catch {
        // 대댓글 실패 무시
      }

      // DB 업데이트
      await supabase
        .from("saju_cs_comment_reports")
        .update({ preview_sent: true, dm_message: dmMessage, error: null })
        .eq("id", comment.id);

      successCount++;
      console.log(`  ✓ ${username} (${comment.birthdate}) → ${previewData.previews.length}개 미리보기 발송`);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      await supabase
        .from("saju_cs_comment_reports")
        .update({ error: errMsg })
        .eq("id", comment.id);
      failCount++;
      console.error(`  ✗ ${username} (${comment.birthdate}) → ${errMsg}`);
    }
  }

  console.log(`\n=== 완료: 성공 ${successCount} / 실패 ${failCount} / 전체 ${comments.length} ===`);
}

main();
