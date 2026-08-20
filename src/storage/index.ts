import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Keychain from 'react-native-keychain';

import {
  ApiSettings,
  ChatMessage,
  Conversation,
  ConversationStore,
  DEFAULT_SETTINGS,
  DEFAULT_PROVIDER_CAPABILITIES,
  MessageContentPart,
  ProviderProfile,
  cloneSettings,
  createConversation,
  getConversationTitle,
} from '../types';

export const SETTINGS_KEY = '@mobigpt/settings/v1';
export const MESSAGES_KEY = '@mobigpt/messages/v1';
export const CONVERSATIONS_KEY = '@mobigpt/conversations/v2';
export const CONVERSATIONS_BACKUP_KEY = '@mobigpt/conversations/v2/backup';
export const ACTIVE_CONVERSATION_KEY = '@mobigpt/active-conversation/v1';
export const PROVIDER_PROFILES_KEY = '@mobigpt/provider-profiles/v1';
export const KEYCHAIN_SERVICE = 'com.pocketpallite.mobigpt.api-key';
const PROVIDER_KEYCHAIN_PREFIX = 'com.pocketpallite.mobigpt.provider.';
export const MAX_STORAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function byteLength(value: string): number {
  return encodeURIComponent(value).replace(/%[A-F\d]{2}/g, 'x').length;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateSettings(value: unknown): ApiSettings | null {
  if (!isRecord(value)) {
    return null;
  }

  const settings: ApiSettings = {
    ...DEFAULT_SETTINGS,
    baseUrl:
      typeof value.baseUrl === 'string'
        ? value.baseUrl
        : DEFAULT_SETTINGS.baseUrl,
    model:
      typeof value.model === 'string' ? value.model : DEFAULT_SETTINGS.model,
    temperature: isFiniteNumber(value.temperature)
      ? Math.min(2, Math.max(0, value.temperature))
      : DEFAULT_SETTINGS.temperature,
    maxTokens: isFiniteNumber(value.maxTokens)
      ? Math.min(1_000_000, Math.max(1, Math.floor(value.maxTokens)))
      : DEFAULT_SETTINGS.maxTokens,
    systemPrompt:
      typeof value.systemPrompt === 'string'
        ? value.systemPrompt.slice(0, 32_000)
        : DEFAULT_SETTINGS.systemPrompt,
    requestTimeoutMs: isFiniteNumber(value.requestTimeoutMs)
      ? Math.min(120_000, Math.max(1_000, Math.floor(value.requestTimeoutMs)))
      : DEFAULT_SETTINGS.requestTimeoutMs,
    stream:
      typeof value.stream === 'boolean'
        ? value.stream
        : DEFAULT_SETTINGS.stream,
  };

  return settings;
}

function validateContentParts(
  value: unknown,
): MessageContentPart[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const parts: MessageContentPart[] = [];
  for (const part of value) {
    if (!isRecord(part) || typeof part.type !== 'string') {
      return undefined;
    }
    if (part.type === 'text' && typeof part.text === 'string') {
      parts.push({type: 'text', text: part.text.slice(0, MAX_STORAGE_BYTES)});
      continue;
    }
    if (part.type === 'image' && isRecord(part.image)) {
      const image = part.image;
      if (
        typeof image.id === 'string' &&
        typeof image.uri === 'string' &&
        typeof image.mimeType === 'string'
      ) {
        parts.push({
          type: 'image',
          image: {
            id: image.id,
            uri: image.uri,
            mimeType: image.mimeType,
            ...(isFiniteNumber(image.width) ? {width: image.width} : {}),
            ...(isFiniteNumber(image.height) ? {height: image.height} : {}),
            ...(isFiniteNumber(image.sizeBytes)
              ? {sizeBytes: image.sizeBytes}
              : {}),
          },
        });
        continue;
      }
    }
    return undefined;
  }
  return parts;
}

function validateMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    (value.role !== 'user' && value.role !== 'assistant') ||
    typeof value.content !== 'string' ||
    !isFiniteNumber(value.createdAt)
  ) {
    return null;
  }

  const allowedStatuses = new Set([
    'completed',
    'streaming',
    'partial',
    'stopped',
    'failed',
  ]);
  return {
    id: value.id,
    role: value.role,
    content: value.content.slice(0, MAX_STORAGE_BYTES),
    ...(validateContentParts(value.contentParts)
      ? {contentParts: validateContentParts(value.contentParts)}
      : {}),
    createdAt: value.createdAt,
    ...(isFiniteNumber(value.updatedAt) ? {updatedAt: value.updatedAt} : {}),
    ...(typeof value.status === 'string' && allowedStatuses.has(value.status)
      ? {status: value.status as ChatMessage['status']}
      : {}),
    ...(typeof value.errorMessage === 'string'
      ? {errorMessage: value.errorMessage.slice(0, 4_000)}
      : {}),
    ...(typeof value.finishReason === 'string'
      ? {finishReason: value.finishReason.slice(0, 128)}
      : {}),
    ...(isRecord(value.usage)
      ? {
          usage: {
            ...(isFiniteNumber(value.usage.promptTokens)
              ? {promptTokens: value.usage.promptTokens}
              : {}),
            ...(isFiniteNumber(value.usage.completionTokens)
              ? {completionTokens: value.usage.completionTokens}
              : {}),
            ...(isFiniteNumber(value.usage.totalTokens)
              ? {totalTokens: value.usage.totalTokens}
              : {}),
          },
        }
      : {}),
  };
}

function validateConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.title !== 'string' ||
    !Array.isArray(value.messages) ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    return null;
  }

  const settings = validateSettings(value.settingsSnapshot);
  const messages = value.messages.map(validateMessage);
  if (!settings || messages.some(message => message === null)) {
    return null;
  }

  return {
    id: value.id,
    title: value.title.slice(0, 120) || 'New conversation',
    messages: messages as ChatMessage[],
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    settingsSnapshot: settings,
  };
}

export function validateConversationStore(
  value: unknown,
): ConversationStore | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !Array.isArray(value.conversations)
  ) {
    return null;
  }
  const conversations = value.conversations.map(validateConversation);
  if (conversations.some(conversation => conversation === null)) {
    return null;
  }
  const activeConversationId =
    typeof value.activeConversationId === 'string'
      ? value.activeConversationId
      : undefined;
  const validIds = new Set(
    (conversations as Conversation[]).map(conversation => conversation.id),
  );
  return {
    schemaVersion: 2,
    conversations: conversations as Conversation[],
    ...(activeConversationId && validIds.has(activeConversationId)
      ? {activeConversationId}
      : {}),
  };
}

function parseStore(value: string | null): ConversationStore | null {
  if (!value || byteLength(value) > MAX_STORAGE_BYTES) {
    return null;
  }
  try {
    return validateConversationStore(JSON.parse(value));
  } catch {
    return null;
  }
}

async function writeStoreAtomically(store: ConversationStore): Promise<void> {
  const serialized = JSON.stringify(store);
  if (byteLength(serialized) > MAX_STORAGE_BYTES) {
    throw new Error(
      'Conversation storage limit exceeded. Delete older conversations and try again.',
    );
  }

  const previous = await AsyncStorage.getItem(CONVERSATIONS_KEY);
  try {
    if (previous) {
      await AsyncStorage.setItem(CONVERSATIONS_BACKUP_KEY, previous);
    }
    await AsyncStorage.setItem(CONVERSATIONS_KEY, serialized);
  } catch (error) {
    if (previous) {
      await AsyncStorage.setItem(CONVERSATIONS_KEY, previous).catch(
        () => undefined,
      );
    }
    throw error;
  }
}

export async function loadSettings(): Promise<ApiSettings> {
  const stored = await AsyncStorage.getItem(SETTINGS_KEY);
  if (!stored) {
    return cloneSettings(DEFAULT_SETTINGS);
  }
  try {
    return (
      validateSettings(JSON.parse(stored)) ?? cloneSettings(DEFAULT_SETTINGS)
    );
  } catch {
    return cloneSettings(DEFAULT_SETTINGS);
  }
}

export async function saveSettings(settings: ApiSettings): Promise<void> {
  const validated =
    validateSettings(settings) ?? cloneSettings(DEFAULT_SETTINGS);
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(validated));
}

export async function loadApiKey(): Promise<string> {
  const credentials = await Keychain.getGenericPassword({
    service: KEYCHAIN_SERVICE,
  });
  return credentials ? credentials.password : '';
}

export async function saveApiKey(apiKey: string): Promise<void> {
  if (apiKey.trim()) {
    await Keychain.setGenericPassword('api-key', apiKey.trim(), {
      service: KEYCHAIN_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await Keychain.resetGenericPassword({service: KEYCHAIN_SERVICE});
  }
}

async function migrateLegacyMessages(): Promise<ConversationStore | null> {
  const legacyMessages = await AsyncStorage.getItem(MESSAGES_KEY);
  if (!legacyMessages) {
    return null;
  }

  try {
    const parsed = JSON.parse(legacyMessages);
    if (!Array.isArray(parsed)) {
      return null;
    }
    const messages = parsed.map(validateMessage);
    if (messages.some(message => message === null)) {
      return null;
    }
    const now = Date.now();
    const conversation: Conversation = {
      ...createConversation(makeId('conversation'), now),
      messages: messages as ChatMessage[],
      title: getConversationTitle(messages as ChatMessage[]),
      updatedAt: (messages as ChatMessage[]).at(-1)?.createdAt ?? now,
    };
    const store: ConversationStore = {
      schemaVersion: 2,
      conversations: [conversation],
      activeConversationId: conversation.id,
    };
    await writeStoreAtomically(store);
    await AsyncStorage.setItem(ACTIVE_CONVERSATION_KEY, conversation.id);
    await AsyncStorage.removeItem(MESSAGES_KEY);
    return store;
  } catch {
    return null;
  }
}

export async function loadConversationStore(): Promise<ConversationStore> {
  const primary = parseStore(await AsyncStorage.getItem(CONVERSATIONS_KEY));
  if (primary) {
    return primary;
  }

  const backup = parseStore(
    await AsyncStorage.getItem(CONVERSATIONS_BACKUP_KEY),
  );
  if (backup) {
    await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(backup)).catch(
      () => undefined,
    );
    return backup;
  }

  const migrated = await migrateLegacyMessages();
  if (migrated) {
    return migrated;
  }

  const now = Date.now();
  const conversation = createConversation(makeId('conversation'), now);
  const emptyStore: ConversationStore = {
    schemaVersion: 2,
    conversations: [conversation],
    activeConversationId: conversation.id,
  };
  await writeStoreAtomically(emptyStore);
  return emptyStore;
}

export async function saveConversationStore(
  store: ConversationStore,
): Promise<void> {
  const validated = validateConversationStore(store);
  if (!validated) {
    throw new Error('Invalid conversation store.');
  }
  await writeStoreAtomically(validated);
  if (validated.activeConversationId) {
    await AsyncStorage.setItem(
      ACTIVE_CONVERSATION_KEY,
      validated.activeConversationId,
    );
  }
}

export async function loadMessages(): Promise<ChatMessage[]> {
  const store = await loadConversationStore();
  const active = store.conversations.find(
    conversation => conversation.id === store.activeConversationId,
  );
  return active?.messages ?? store.conversations[0]?.messages ?? [];
}

export async function saveMessages(messages: ChatMessage[]): Promise<void> {
  const store = await loadConversationStore();
  const activeId = store.activeConversationId ?? store.conversations[0]?.id;
  if (!activeId) {
    return;
  }
  const now = Date.now();
  const conversations = store.conversations.map(conversation =>
    conversation.id === activeId
      ? {
          ...conversation,
          messages,
          title:
            conversation.title === 'New conversation'
              ? getConversationTitle(messages)
              : conversation.title,
          updatedAt: now,
        }
      : conversation,
  );
  await saveConversationStore({
    ...store,
    conversations,
    activeConversationId: activeId,
  });
}

export async function createStoredConversation(
  settings: ApiSettings = DEFAULT_SETTINGS,
): Promise<Conversation> {
  const store = await loadConversationStore();
  const now = Date.now();
  const conversation = createConversation(
    makeId('conversation'),
    now,
    settings,
  );
  await saveConversationStore({
    schemaVersion: 2,
    conversations: [...store.conversations, conversation],
    activeConversationId: conversation.id,
  });
  return conversation;
}

export async function updateConversation(
  id: string,
  update: Partial<
    Pick<Conversation, 'title' | 'messages' | 'settingsSnapshot'>
  >,
): Promise<Conversation | null> {
  const store = await loadConversationStore();
  const now = Date.now();
  let updated: Conversation | null = null;
  const conversations = store.conversations.map(conversation => {
    if (conversation.id !== id) {
      return conversation;
    }
    updated = {
      ...conversation,
      ...update,
      title: update.title?.trim().slice(0, 120) || conversation.title,
      updatedAt: now,
      settingsSnapshot: update.settingsSnapshot
        ? cloneSettings(update.settingsSnapshot)
        : conversation.settingsSnapshot,
    };
    return updated;
  });
  if (!updated) {
    return null;
  }
  await saveConversationStore({
    ...store,
    conversations,
    activeConversationId: id,
  });
  return updated;
}

export async function deleteStoredConversation(id: string): Promise<void> {
  const store = await loadConversationStore();
  const remaining = store.conversations.filter(
    conversation => conversation.id !== id,
  );
  if (remaining.length === 0) {
    const replacement = createConversation(makeId('conversation'), Date.now());
    remaining.push(replacement);
  }
  const activeConversationId = remaining.some(
    conversation => conversation.id === store.activeConversationId,
  )
    ? store.activeConversationId
    : remaining[0].id;
  await saveConversationStore({
    schemaVersion: 2,
    conversations: remaining,
    activeConversationId,
  });
}

export async function duplicateStoredConversation(
  id: string,
): Promise<Conversation | null> {
  const store = await loadConversationStore();
  const source = store.conversations.find(
    conversation => conversation.id === id,
  );
  if (!source) {
    return null;
  }
  const now = Date.now();
  const duplicate: Conversation = {
    ...source,
    id: makeId('conversation'),
    title: `${source.title} copy`.slice(0, 120),
    messages: source.messages.map(message => ({
      ...message,
      id: makeId('message'),
    })),
    createdAt: now,
    updatedAt: now,
    settingsSnapshot: cloneSettings(source.settingsSnapshot),
  };
  await saveConversationStore({
    schemaVersion: 2,
    conversations: [...store.conversations, duplicate],
    activeConversationId: duplicate.id,
  });
  return duplicate;
}

export async function clearMessages(): Promise<void> {
  const store = await loadConversationStore();
  const activeId = store.activeConversationId ?? store.conversations[0]?.id;
  if (!activeId) {
    return;
  }
  const conversations = store.conversations.map(conversation =>
    conversation.id === activeId
      ? {
          ...conversation,
          messages: [],
          title: 'New conversation',
          updatedAt: Date.now(),
        }
      : conversation,
  );
  await saveConversationStore({
    ...store,
    conversations,
    activeConversationId: activeId,
  });
}

export function serializeConversationExport(store: ConversationStore): string {
  const exportStore: ConversationStore = {
    schemaVersion: 2,
    conversations: store.conversations.map(conversation => ({
      ...conversation,
      settingsSnapshot: cloneSettings(conversation.settingsSnapshot),
    })),
    ...(store.activeConversationId
      ? {activeConversationId: store.activeConversationId}
      : {}),
  };
  const serialized = JSON.stringify(exportStore, null, 2);
  if (byteLength(serialized) > MAX_IMPORT_BYTES) {
    throw new Error('Export exceeds the supported size limit.');
  }
  return serialized;
}

export function parseConversationImport(serialized: string): ConversationStore {
  if (byteLength(serialized) > MAX_IMPORT_BYTES) {
    throw new Error('Import exceeds the supported size limit.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('Import is not valid JSON.');
  }
  const store = validateConversationStore(parsed);
  if (!store) {
    throw new Error('Import does not match a supported conversation schema.');
  }
  return store;
}

export async function clearAllLocalData(): Promise<void> {
  const profiles = await loadProviderProfiles();
  await AsyncStorage.multiRemove([
    SETTINGS_KEY,
    MESSAGES_KEY,
    CONVERSATIONS_KEY,
    CONVERSATIONS_BACKUP_KEY,
    ACTIVE_CONVERSATION_KEY,
    PROVIDER_PROFILES_KEY,
  ]);
  await Promise.all(profiles.map(profile => deleteProviderApiKey(profile.id)));
  await saveApiKey('');
}

function validateProviderProfile(value: unknown): ProviderProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.providerId !== 'string' ||
    typeof value.baseUrl !== 'string' ||
    typeof value.model !== 'string' ||
    !isFiniteNumber(value.temperature) ||
    !isFiniteNumber(value.maxTokens) ||
    typeof value.systemPrompt !== 'string' ||
    typeof value.apiKeyStored !== 'boolean' ||
    typeof value.trustedEndpoint !== 'boolean' ||
    !isRecord(value.capabilities) ||
    typeof value.capabilities.streaming !== 'boolean' ||
    typeof value.capabilities.multimodal !== 'boolean' ||
    typeof value.capabilities.modelDiscovery !== 'boolean' ||
    !isFiniteNumber(value.createdAt) ||
    !isFiniteNumber(value.updatedAt)
  ) {
    return null;
  }
  const providerIds = new Set([
    'openai',
    'openrouter',
    'ollama',
    'lmstudio',
    'custom',
  ]);
  if (!providerIds.has(value.providerId)) {
    return null;
  }
  return {
    id: value.id,
    name: value.name.slice(0, 120),
    providerId: value.providerId as ProviderProfile['providerId'],
    baseUrl: value.baseUrl.slice(0, 2_000),
    model: value.model.slice(0, 300),
    temperature: Math.min(2, Math.max(0, value.temperature)),
    maxTokens: Math.min(1_000_000, Math.max(1, Math.floor(value.maxTokens))),
    systemPrompt: value.systemPrompt.slice(0, 32_000),
    apiKeyStored: value.apiKeyStored,
    trustedEndpoint: value.trustedEndpoint,
    capabilities: {
      streaming: value.capabilities.streaming,
      multimodal: value.capabilities.multimodal,
      modelDiscovery: value.capabilities.modelDiscovery,
    },
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export async function loadProviderProfiles(): Promise<ProviderProfile[]> {
  const stored = await AsyncStorage.getItem(PROVIDER_PROFILES_KEY);
  if (!stored || byteLength(stored) > MAX_STORAGE_BYTES) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.flatMap(profile => {
      const validated = validateProviderProfile(profile);
      return validated ? [validated] : [];
    });
  } catch {
    return [];
  }
}

export async function saveProviderProfiles(
  profiles: ProviderProfile[],
): Promise<void> {
  const serialized = JSON.stringify(
    profiles.map(profile => ({
      ...profile,
      capabilities: {...DEFAULT_PROVIDER_CAPABILITIES, ...profile.capabilities},
    })),
  );
  if (byteLength(serialized) > MAX_STORAGE_BYTES) {
    throw new Error('Provider profile storage limit exceeded.');
  }
  await AsyncStorage.setItem(PROVIDER_PROFILES_KEY, serialized);
}

function providerKeychainService(profileId: string): string {
  return `${PROVIDER_KEYCHAIN_PREFIX}${profileId.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
}

export async function loadProviderApiKey(profileId: string): Promise<string> {
  const credentials = await Keychain.getGenericPassword({
    service: providerKeychainService(profileId),
  });
  return credentials ? credentials.password : '';
}

export async function saveProviderApiKey(
  profileId: string,
  apiKey: string,
): Promise<void> {
  const service = providerKeychainService(profileId);
  if (apiKey.trim()) {
    await Keychain.setGenericPassword('api-key', apiKey.trim(), {
      service,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } else {
    await Keychain.resetGenericPassword({service});
  }
}

export async function deleteProviderApiKey(profileId: string): Promise<void> {
  await Keychain.resetGenericPassword({
    service: providerKeychainService(profileId),
  });
}
