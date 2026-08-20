export type MessageRole = 'system' | 'user' | 'assistant';

export type MessageStatus =
  | 'completed'
  | 'streaming'
  | 'partial'
  | 'stopped'
  | 'failed';

export type ImageAttachment = {
  id: string;
  uri: string;
  mimeType: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
};

export type MessageContentPart =
  | {type: 'text'; text: string}
  | {type: 'image'; image: ImageAttachment};

export type ApiContentPart =
  | {type: 'text'; text: string}
  | {type: 'image_url'; image_url: {url: string}};

export type ChatRequestMessage = {
  role: MessageRole;
  content: string | ApiContentPart[];
};

export type ChatMessage = {
  id: string;
  role: Exclude<MessageRole, 'system'>;
  content: string;
  contentParts?: MessageContentPart[];
  createdAt: number;
  updatedAt?: number;
  status?: MessageStatus;
  errorMessage?: string;
  finishReason?: string;
  usage?: ChatUsage;
};

export type ChatUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type ProviderId =
  | 'openai'
  | 'openrouter'
  | 'ollama'
  | 'lmstudio'
  | 'custom';

export type ProviderCapabilities = {
  streaming: boolean;
  multimodal: boolean;
  modelDiscovery: boolean;
};

export type ProviderProfile = {
  id: string;
  name: string;
  providerId: ProviderId;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  apiKeyStored: boolean;
  trustedEndpoint: boolean;
  capabilities: ProviderCapabilities;
  createdAt: number;
  updatedAt: number;
};

export type ModelInfo = {
  id: string;
  ownedBy?: string;
};

export type ProviderValidationError = {
  field: 'name' | 'baseUrl' | 'model' | 'temperature' | 'maxTokens';
  message: string;
};

export type ApiSettings = {
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  requestTimeoutMs?: number;
  stream?: boolean;
};

export type Conversation = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  settingsSnapshot: ApiSettings;
};

export type ConversationStore = {
  schemaVersion: 2;
  conversations: Conversation[];
  activeConversationId?: string;
};

export type ApiErrorKind =
  | 'configuration'
  | 'authentication'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'parse'
  | 'unknown';

export type NormalizedApiError = {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  retryable: boolean;
};

export const DEFAULT_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  multimodal: false,
  modelDiscovery: true,
};

export const DEFAULT_SETTINGS: ApiSettings = {
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  maxTokens: 1024,
  systemPrompt: 'You are a helpful, concise assistant.',
  requestTimeoutMs: 30_000,
  stream: true,
};

export function cloneSettings(settings: ApiSettings): ApiSettings {
  return {...DEFAULT_SETTINGS, ...settings};
}

export function getConversationTitle(messages: ChatMessage[]): string {
  const firstUserMessage = messages.find(message => message.role === 'user');
  const title = firstUserMessage?.content.trim().replace(/\s+/g, ' ');
  if (!title) {
    return 'New conversation';
  }
  return title.length > 48 ? `${title.slice(0, 45)}…` : title;
}

export function createConversation(
  id: string,
  now: number,
  settings: ApiSettings = DEFAULT_SETTINGS,
): Conversation {
  return {
    id,
    title: 'New conversation',
    messages: [],
    createdAt: now,
    updatedAt: now,
    settingsSnapshot: cloneSettings(settings),
  };
}
