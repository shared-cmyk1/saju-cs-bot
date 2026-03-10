-- ============================================
-- 계정 4개 등록 (사주로그 + 신규 3개)
-- migrations/001, 002 실행 후에 실행하세요
-- ⚠️ 실행 전에 YOUR_* 플레이스홀더를 실제 값으로 교체하세요
-- ============================================

-- 1. 사주로그 (기존 계정, 리포트 API 있음)
INSERT INTO saju_cs_accounts (
    slug, display_name,
    instagram_business_account_id, instagram_access_token, instagram_username,
    slack_channel_id,
    report_api_url, report_api_key
) VALUES (
    'saju_log', '사주로그',
    'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    'YOUR_INSTAGRAM_ACCESS_TOKEN',
    'saju_log',
    'YOUR_SLACK_CHANNEL_ID',
    'YOUR_REPORT_API_URL',
    'YOUR_REPORT_API_KEY'
);

-- 2. 운세저장소
INSERT INTO saju_cs_accounts (
    slug, display_name,
    instagram_business_account_id, instagram_access_token, instagram_username,
    slack_channel_id
) VALUES (
    'unse_jeojangso', '운세저장소',
    'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    'YOUR_INSTAGRAM_ACCESS_TOKEN',
    'unse_jeojangso_',
    'YOUR_SLACK_CHANNEL_ID'
);

-- 3. 사주마을
INSERT INTO saju_cs_accounts (
    slug, display_name,
    instagram_business_account_id, instagram_access_token, instagram_username,
    slack_channel_id
) VALUES (
    'saju_maeul', '사주마을',
    'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    'YOUR_INSTAGRAM_ACCESS_TOKEN',
    'saju_maeul',
    'YOUR_SLACK_CHANNEL_ID'
);

-- 4. 운세라운지
INSERT INTO saju_cs_accounts (
    slug, display_name,
    instagram_business_account_id, instagram_access_token, instagram_username,
    slack_channel_id
) VALUES (
    'unse_lounge', '운세라운지',
    'YOUR_INSTAGRAM_BUSINESS_ACCOUNT_ID',
    'YOUR_INSTAGRAM_ACCESS_TOKEN',
    'unse_lounge',
    'YOUR_SLACK_CHANNEL_ID'
);
