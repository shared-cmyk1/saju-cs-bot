-- 사주로그 계정: 댓글 보고서를 연애보고서(ROMANTIC)만 전송하도록 설정
UPDATE saju_cs_accounts
SET service_map = jsonb_build_object('comment_goods_types', '["ROMANTIC"]'::jsonb)
WHERE slug = 'saju_log';
