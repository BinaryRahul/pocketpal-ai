const mockStorage = new Map<string, string>();
const mockKeychain = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStorage.delete(key);
  }),
  multiRemove: jest.fn(async (keys: string[]) => {
    keys.forEach(key => mockStorage.delete(key));
  }),
}));

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  },
  getGenericPassword: jest.fn(async ({service}: {service: string}) => {
    const password = mockKeychain.get(service);
    return password ? {username: 'api-key', password} : false;
  }),
  setGenericPassword: jest.fn(
    async (
      _username: string,
      password: string,
      {service}: {service: string},
    ) => {
      mockKeychain.set(service, password);
      return true;
    },
  ),
  resetGenericPassword: jest.fn(async ({service}: {service: string}) => {
    mockKeychain.delete(service);
    return true;
  }),
}));

import {
  ACTIVE_CONVERSATION_KEY,
  CONVERSATIONS_BACKUP_KEY,
  CONVERSATIONS_KEY,
  MESSAGES_KEY,
  clearAllLocalData,
  createStoredConversation,
  deleteStoredConversation,
  duplicateStoredConversation,
  loadConversationStore,
  parseConversationImport,
  saveConversationStore,
  saveProviderApiKey,
  saveProviderProfiles,
  serializeConversationExport,
  updateConversation,
  validateConversationStore,
} from '../src/storage';
import {
  DEFAULT_SETTINGS,
  ConversationStore,
  ProviderProfile,
} from '../src/types';

describe('conversation storage', () => {
  beforeEach(() => {
    mockStorage.clear();
    mockKeychain.clear();
    jest.clearAllMocks();
  });

  it('migrates the legacy transcript exactly once', async () => {
    mockStorage.set(
      MESSAGES_KEY,
      JSON.stringify([
        {id: 'u1', role: 'user', content: 'Hello', createdAt: 10},
        {id: 'a1', role: 'assistant', content: 'Hi', createdAt: 11},
      ]),
    );

    const first = await loadConversationStore();
    expect(first.schemaVersion).toBe(2);
    expect(first.conversations).toHaveLength(1);
    expect(first.conversations[0].messages).toHaveLength(2);
    expect(mockStorage.has(MESSAGES_KEY)).toBe(false);
    expect(mockStorage.get(ACTIVE_CONVERSATION_KEY)).toBe(
      first.activeConversationId,
    );

    const second = await loadConversationStore();
    expect(second).toEqual(first);
  });

  it('recovers from a valid backup when the primary is corrupt', async () => {
    const backup: ConversationStore = {
      schemaVersion: 2,
      conversations: [
        {
          id: 'c1',
          title: 'Recovered',
          messages: [],
          createdAt: 1,
          updatedAt: 2,
          settingsSnapshot: DEFAULT_SETTINGS,
        },
      ],
      activeConversationId: 'c1',
    };
    mockStorage.set(CONVERSATIONS_KEY, '{bad json');
    mockStorage.set(CONVERSATIONS_BACKUP_KEY, JSON.stringify(backup));

    await expect(loadConversationStore()).resolves.toEqual(backup);
    expect(mockStorage.get(CONVERSATIONS_KEY)).toBe(JSON.stringify(backup));
  });

  it('rejects malformed stores and clamps unsafe settings', () => {
    expect(
      validateConversationStore({schemaVersion: 1, conversations: []}),
    ).toBeNull();
    const result = validateConversationStore({
      schemaVersion: 2,
      conversations: [
        {
          id: 'c1',
          title: 'x'.repeat(500),
          messages: [],
          createdAt: 1,
          updatedAt: 2,
          settingsSnapshot: {
            ...DEFAULT_SETTINGS,
            temperature: 99,
            maxTokens: -10,
          },
        },
      ],
    });
    expect(result?.conversations[0].title).toHaveLength(120);
    expect(result?.conversations[0].settingsSnapshot.temperature).toBe(2);
    expect(result?.conversations[0].settingsSnapshot.maxTokens).toBe(1);
  });

  it('supports create, update, duplicate, and delete operations', async () => {
    const created = await createStoredConversation();
    expect(created.title).toBe('New conversation');

    const updated = await updateConversation(created.id, {title: 'Renamed'});
    expect(updated?.title).toBe('Renamed');

    const duplicate = await duplicateStoredConversation(created.id);
    expect(duplicate?.id).not.toBe(created.id);
    expect(duplicate?.title).toBe('Renamed copy');

    await deleteStoredConversation(created.id);
    const afterDelete = await loadConversationStore();
    expect(
      afterDelete.conversations.some(
        conversation => conversation.id === created.id,
      ),
    ).toBe(false);
    expect(afterDelete.conversations).toHaveLength(2);
  });

  it('exports and validates versioned conversations without accepting malformed imports', async () => {
    const store = await loadConversationStore();
    const serialized = serializeConversationExport(store);
    expect(parseConversationImport(serialized)).toEqual(store);
    expect(() => parseConversationImport('{"schemaVersion":1}')).toThrow(
      'supported conversation schema',
    );
  });

  it('rejects an invalid store before writing it', async () => {
    await expect(
      saveConversationStore({
        schemaVersion: 1,
        conversations: [],
      } as unknown as ConversationStore),
    ).rejects.toThrow('Invalid conversation store');
  });

  it('clears provider metadata, secure keys, and conversation data together', async () => {
    const profile: ProviderProfile = {
      id: 'p1',
      name: 'Test provider',
      providerId: 'custom',
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      temperature: 0.5,
      maxTokens: 100,
      systemPrompt: '',
      apiKeyStored: true,
      trustedEndpoint: true,
      capabilities: {streaming: true, multimodal: false, modelDiscovery: true},
      createdAt: 1,
      updatedAt: 1,
    };
    await saveProviderProfiles([profile]);
    await saveProviderApiKey(profile.id, 'sk-profile');
    await clearAllLocalData();
    expect(mockStorage.size).toBe(0);
    expect(mockKeychain.size).toBe(0);
  });
});
