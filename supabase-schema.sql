-- Saju CS Bot - Database Schema
-- Run this in Supabase SQL Editor

-- 1. Conversations (Instagram 사용자별 대화)
CREATE TABLE saju_cs_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instagram_user_id TEXT NOT NULL,
    instagram_username TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(instagram_user_id)
);

CREATE INDEX idx_conversations_ig_user ON saju_cs_conversations(instagram_user_id);

-- 2. Messages (대화 내 메시지)
CREATE TABLE saju_cs_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES saju_cs_conversations(id) ON DELETE CASCADE,
    message_index INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'human', 'user')),
    instagram_mid TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(conversation_id, message_index)
);

CREATE INDEX idx_messages_conv_order ON saju_cs_messages(conversation_id, message_index ASC);

-- 3. Escalations (Slack 에스컬레이션)
CREATE TABLE saju_cs_escalations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES saju_cs_conversations(id) ON DELETE CASCADE,
    user_message_id UUID NOT NULL REFERENCES saju_cs_messages(id),
    slack_channel_id TEXT NOT NULL,
    slack_message_ts TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'answered')),
    team_response TEXT,
    responded_by TEXT,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_escalations_status ON saju_cs_escalations(status);
CREATE INDEX idx_escalations_slack ON saju_cs_escalations(slack_channel_id, slack_message_ts);
CREATE INDEX idx_escalations_conv ON saju_cs_escalations(conversation_id, status);
