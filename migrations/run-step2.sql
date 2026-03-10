CREATE TABLE saju_cs_comment_reports (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), account_id UUID NOT NULL REFERENCES saju_cs_accounts(id), comment_id TEXT NOT NULL UNIQUE, media_id TEXT NOT NULL, instagram_user_id TEXT NOT NULL, instagram_username TEXT, comment_text TEXT NOT NULL, birthdate TEXT, birth_time TEXT, preview_sent BOOLEAN NOT NULL DEFAULT false, dm_message TEXT, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
CREATE INDEX idx_comment_reports_account ON saju_cs_comment_reports(account_id);
CREATE INDEX idx_comment_reports_media ON saju_cs_comment_reports(media_id);
CREATE INDEX idx_comment_reports_user ON saju_cs_comment_reports(instagram_user_id);
