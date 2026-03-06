CREATE TABLE saju_cs_report_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES saju_cs_conversations(id) ON DELETE CASCADE,
    instagram_user_id TEXT NOT NULL,
    goods_type TEXT,
    step TEXT NOT NULL DEFAULT 'awaiting_service'
        CHECK (step IN (
            'awaiting_service',
            'awaiting_info',
            'awaiting_partner_info',
            'confirming',
            'generating',
            'completed',
            'failed',
            'expired'
        )),
    my_info JSONB DEFAULT '{}',
    partner_info JSONB DEFAULT '{}',
    shop_order_no TEXT,
    report_url TEXT,
    poll_count INTEGER DEFAULT 0,
    initiated_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX idx_report_sessions_conv ON saju_cs_report_sessions(conversation_id);
CREATE INDEX idx_report_sessions_step ON saju_cs_report_sessions(step);
CREATE INDEX idx_report_sessions_expires ON saju_cs_report_sessions(expires_at);
