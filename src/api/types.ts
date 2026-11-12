/** OpenAI-compatible wire types used with the Gisoo API. No runtime imports. */

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream: true;
  stream_options: { include_usage: true };
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none';
  parallel_tool_calls?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export interface WireUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface WireModel {
  id: string;
  name?: string;
  type?: string;
  description?: string;
  context_length?: number;
  max_output_tokens?: number;
  capabilities?: {
    streaming?: boolean;
    tools?: boolean;
    json?: boolean;
    vision?: boolean;
    reasoning?: boolean;
  };
  is_free?: boolean;
  pricing?: {
    input_per_million?: number;
    output_per_million?: number;
    cached_input_per_million?: number;
  };
}

export interface MeResponse {
  balance?: { usd?: number; usd_display?: string };
  status?: string;
  project?: { id?: number | string; name?: string };
  key?: { name?: string; prefix?: string; spend_limit_usd?: number | null; spent_usd?: number };
}

export interface TokenResponse {
  api_key: string;
  base_url?: string;
}
