CREATE TABLE saju_cs_learning_pairs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES saju_cs_conversations(id) ON DELETE CASCADE,
    customer_message TEXT NOT NULL,
    agent_response TEXT NOT NULL,
    category TEXT,
    categorized_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_learning_pairs_category ON saju_cs_learning_pairs(category);
CREATE INDEX idx_learning_pairs_conv ON saju_cs_learning_pairs(conversation_id);

CREATE TABLE saju_cs_auto_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category TEXT NOT NULL UNIQUE,
    description TEXT,
    template_response TEXT NOT NULL,
    example_questions TEXT[] DEFAULT '{}',
    pair_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected')),
    slack_message_ts TEXT,
    slack_channel_id TEXT,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auto_rules_status ON saju_cs_auto_rules(status);

CREATE TABLE saju_cs_pending_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id UUID NOT NULL REFERENCES saju_cs_auto_rules(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES saju_cs_conversations(id) ON DELETE CASCADE,
    instagram_user_id TEXT NOT NULL,
    customer_message TEXT NOT NULL,
    proposed_response TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'rejected')),
    slack_message_ts TEXT,
    slack_channel_id TEXT,
    responded_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_responses_status ON saju_cs_pending_responses(status);
CREATE INDEX idx_pending_responses_rule ON saju_cs_pending_responses(rule_id);
