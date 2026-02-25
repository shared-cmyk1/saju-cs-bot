// === Database Types ===

export interface Conversation {
  id: string;
  instagram_user_id: string;
  instagram_username: string | null;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  message_index: number;
  role: 'user' | 'assistant';
  content: string;
  source: 'ai' | 'human' | 'user' | 'system';
  instagram_mid: string | null;
  created_at: string;
}

export interface Escalation {
  id: string;
  conversation_id: string;
  user_message_id: string;
  slack_channel_id: string;
  slack_message_ts: string;
  status: 'pending' | 'answered';
  team_response: string | null;
  responded_by: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

// === Learning Types ===

export interface LearningPair {
  id: string;
  conversation_id: string;
  customer_message: string;
  agent_response: string;
  category: string | null;
  categorized_at: string | null;
  created_at: string;
}

export interface AutoRule {
  id: string;
  category: string;
  description: string | null;
  template_response: string;
  example_questions: string[];
  pair_count: number;
  status: 'proposed' | 'approved' | 'rejected';
  slack_message_ts: string | null;
  slack_channel_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingResponse {
  id: string;
  rule_id: string;
  conversation_id: string;
  instagram_user_id: string;
  customer_message: string;
  proposed_response: string;
  status: 'pending' | 'sent' | 'rejected';
  slack_message_ts: string | null;
  slack_channel_id: string | null;
  responded_by: string | null;
  created_at: string;
}

export interface CategoryAnalysis {
  category: string;
  description: string;
  templateResponse: string;
  exampleQuestions: string[];
  pairCount: number;
}

// === AI Types ===

export interface CSBotInput {
  faqContent: string;
  conversationHistory: Array<{ role: string; content: string }>;
  currentMessage: string;
  username?: string;
}

export interface CSBotOutput {
  shouldEscalate: boolean;
  answer: string;
  suggestedAnswer?: string;
  matchedFAQ?: string;
  reasoning?: string;
}

// === Instagram Types ===

export interface InstagramMessageEvent {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    attachments?: Array<{ type: string; payload: { url: string } }>;
  };
}

export interface InstagramWebhookBody {
  object: string;
  entry: Array<{
    id: string;
    time: number;
    messaging?: InstagramMessageEvent[];
  }>;
}

// === Slack Types ===

export interface SlackEscalationParams {
  conversationId: string;
  instagramUserId: string;
  username: string | null;
  userQuestion: string;
}

export interface SlackInteractionPayload {
  type: 'block_actions' | 'view_submission';
  trigger_id?: string;
  user: { id: string; username: string };
  actions?: Array<{
    action_id: string;
    value: string;
  }>;
  view?: {
    callback_id: string;
    private_metadata: string;
    state: {
      values: Record<string, Record<string, { value: string }>>;
    };
  };
}
