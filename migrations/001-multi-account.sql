-- ============================================
-- Multi-Account (Multi-tenant) Migration
-- ============================================

-- 1. 계정 설정 테이블
CREATE TABLE saju_cs_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,

    -- Instagram
    instagram_business_account_id TEXT NOT NULL UNIQUE,
    instagram_access_token TEXT NOT NULL,
    instagram_username TEXT,

    -- Slack
    slack_channel_id TEXT NOT NULL,

    -- FAQ (DB에 저장, 파일시스템 대신)
    faq_content TEXT,

    -- 업무시간 설정
    business_hours_timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
    business_hours_start INTEGER NOT NULL DEFAULT 10,
    business_hours_end INTEGER NOT NULL DEFAULT 19,
    business_days INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',

    -- 업무외 메시지 (null이면 기본 템플릿 사용)
    off_hours_message TEXT,

    -- Report API (null이면 환경변수 fallback)
    report_api_url TEXT,
    report_api_key TEXT,

    -- 서비스 매핑 오버라이드 (null이면 기본값 사용)
    service_map JSONB,

    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_accounts_ig_id ON saju_cs_accounts(instagram_business_account_id);

-- 2. 기존 테이블에 account_id 추가 (nullable로 시작)
ALTER TABLE saju_cs_conversations ADD COLUMN account_id UUID REFERENCES saju_cs_accounts(id);
ALTER TABLE saju_cs_escalations ADD COLUMN account_id UUID REFERENCES saju_cs_accounts(id);
ALTER TABLE saju_cs_learning_pairs ADD COLUMN account_id UUID REFERENCES saju_cs_accounts(id);
ALTER TABLE saju_cs_auto_rules ADD COLUMN account_id UUID REFERENCES saju_cs_accounts(id);
ALTER TABLE saju_cs_pending_responses ADD COLUMN account_id UUID REFERENCES saju_cs_accounts(id);
ALTER TABLE saju_cs_report_sessions ADD COLUMN account_id UUID REFERENCES saju_cs_accounts(id);

-- 3. 기존 saju_log 계정 생성 후, 기존 데이터 백필
-- ⚠️ 실행 전 아래 값들을 실제 환경변수 값으로 교체하세요!
/*
INSERT INTO saju_cs_accounts (
    slug, display_name,
    instagram_business_account_id, instagram_access_token, instagram_username,
    slack_channel_id, faq_content
) VALUES (
    'saju_log', '사주로그',
    '<INSTAGRAM_BUSINESS_ACCOUNT_ID>',
    '<INSTAGRAM_USER_ACCESS_TOKEN>',
    '@saju_log',
    '<SLACK_CS_CHANNEL_ID>',
    '<FAQ.md 내용>'
);

-- 백필 (saju_log 계정 UUID로 교체)
UPDATE saju_cs_conversations SET account_id = '<ACCOUNT_UUID>';
UPDATE saju_cs_escalations SET account_id = '<ACCOUNT_UUID>';
UPDATE saju_cs_learning_pairs SET account_id = '<ACCOUNT_UUID>';
UPDATE saju_cs_auto_rules SET account_id = '<ACCOUNT_UUID>';
UPDATE saju_cs_pending_responses SET account_id = '<ACCOUNT_UUID>';
UPDATE saju_cs_report_sessions SET account_id = '<ACCOUNT_UUID>';
*/

-- 4. NOT NULL 제약 추가 (백필 완료 후 실행)
/*
ALTER TABLE saju_cs_conversations ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE saju_cs_escalations ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE saju_cs_learning_pairs ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE saju_cs_auto_rules ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE saju_cs_pending_responses ALTER COLUMN account_id SET NOT NULL;
ALTER TABLE saju_cs_report_sessions ALTER COLUMN account_id SET NOT NULL;
*/

-- 5. UNIQUE 제약 변경
/*
ALTER TABLE saju_cs_conversations
    DROP CONSTRAINT saju_cs_conversations_instagram_user_id_key,
    ADD CONSTRAINT uq_conversations_account_user UNIQUE(account_id, instagram_user_id);

ALTER TABLE saju_cs_auto_rules
    DROP CONSTRAINT saju_cs_auto_rules_category_key,
    ADD CONSTRAINT uq_auto_rules_account_category UNIQUE(account_id, category);
*/

-- 6. 인덱스
CREATE INDEX idx_conversations_account ON saju_cs_conversations(account_id);
CREATE INDEX idx_escalations_account ON saju_cs_escalations(account_id);
CREATE INDEX idx_learning_pairs_account ON saju_cs_learning_pairs(account_id);
CREATE INDEX idx_auto_rules_account ON saju_cs_auto_rules(account_id);
CREATE INDEX idx_pending_responses_account ON saju_cs_pending_responses(account_id);
CREATE INDEX idx_report_sessions_account ON saju_cs_report_sessions(account_id);
