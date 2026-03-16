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

async function main() {
  // 1. birthdate가 null이고 preview 안 보낸 댓글 조회
  const { data: failed, error } = await supabase
    .from("saju_cs_comment_reports")
    .select("id, comment_text, comment_id, instagram_user_id, instagram_username, account_id")
    .eq("preview_sent", false)
    .is("birthdate", null)
    .not("comment_text", "is", null)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("DB error:", error);
    process.exit(1);
  }
  console.log(`Found ${failed?.length || 0} failed comments to re-extract`);

  if (!failed || failed.length === 0) {
    console.log("Nothing to do");
    process.exit(0);
  }

  // 2. 각 댓글에서 생년월일 재추출
  let updated = 0;
  for (const row of failed) {
    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        temperature: 0,
        system: `Instagram 댓글에서 생년월일 정보를 추출하세요.
다양한 형식 인식: "950302", "95.03.02", "95년 3월 2일", "01.08.07" 등
6자리 숫자는 YYMMDD로 해석하세요.
반드시 JSON만 응답: {"hasBirthdate":true,"birthdate":"YYYYMMDD","birthTime":null,"gender":null}
생년월일이 없으면: {"hasBirthdate":false}`,
        messages: [{ role: "user", content: row.comment_text }],
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const parsed = JSON.parse(text.replace(/```json?\n?/g, "").replace(/```/g, "").trim());

      if (parsed.hasBirthdate && parsed.birthdate) {
        await supabase
          .from("saju_cs_comment_reports")
          .update({ birthdate: parsed.birthdate, birth_time: parsed.birthTime || null })
          .eq("id", row.id);
        updated++;
        console.log(`  ✓ "${row.comment_text}" → ${parsed.birthdate}`);
      } else {
        console.log(`  ✗ "${row.comment_text}" → no birthdate`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.substring(0, 80) : String(e);
      console.error(`  ! Error for ${row.id}:`, msg);
    }
  }

  console.log(`\nUpdated ${updated}/${failed.length} records with birthdates`);

  if (updated > 0) {
    console.log("\nNow run retry-comments API to send previews...");
  }
}

main();
