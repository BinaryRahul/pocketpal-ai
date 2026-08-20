import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {ConversationPanel} from './src/components/ConversationPanel';
import {streamChatCompletion, ChatStream} from './src/api/openai';
import {
  loadApiKey,
  loadSettings,
  saveApiKey,
  saveSettings,
} from './src/storage';
import {useConversations} from './src/chat/useConversations';
import {ApiSettings, ChatMessage, DEFAULT_SETTINGS} from './src/types';

const colors = {
  background: '#101318',
  surface: '#1a2029',
  surfaceRaised: '#232b37',
  border: '#313b4a',
  text: '#f5f7fa',
  muted: '#9aa7b7',
  accent: '#75a7ff',
  danger: '#ff9b9b',
  userBubble: '#2c5d9f',
};

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function MessageBubble({message}: {message: ChatMessage}) {
  const isUser = message.role === 'user';
  const stateLabel =
    message.status && message.status !== 'completed'
      ? ` · ${message.status}`
      : '';
  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      <View style={[styles.messageBubble, isUser && styles.userBubble]}>
        <Text style={styles.messageRole}>
          {isUser ? 'You' : `MobiGPT${stateLabel}`}
        </Text>
        <Text style={styles.messageText} selectable>
          {message.content || '…'}
        </Text>
        {message.errorMessage ? (
          <Text style={styles.errorText}>{message.errorMessage}</Text>
        ) : null}
      </View>
    </View>
  );
}

export default function App() {
  const [settings, setSettings] = useState<ApiSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [status, setStatus] = useState('');
  const streamRef = useRef<ChatStream | null>(null);
  const conversations = useConversations();

  useEffect(() => {
    let mounted = true;
    const restore = async () => {
      try {
        const savedSettings = await loadSettings();
        if (mounted) {
          setSettings(savedSettings);
        }
      } catch {
        if (mounted) {
          setStatus('Could not restore connection settings.');
        }
      }
      try {
        const savedApiKey = await loadApiKey();
        if (mounted) {
          setApiKey(savedApiKey);
          setApiKeyDraft(savedApiKey);
        }
      } catch {
        if (mounted) {
          setStatus('API key storage is unavailable on this device.');
        }
      }
      if (mounted) {
        setLocalReady(true);
      }
    };
    restore();
    return () => {
      mounted = false;
      streamRef.current?.close();
    };
  }, []);

  const activeConversation = conversations.activeConversation;
  const saveConversationMessages = conversations.saveMessages;

  useEffect(() => {
    if (!conversations.ready || !activeConversation) {
      return;
    }
    setMessages(activeConversation.messages);
    setSettings(activeConversation.settingsSnapshot);
    setInput('');
    setStatus('');
  }, [activeConversation, conversations.ready]);

  useEffect(() => {
    if (
      localReady &&
      conversations.ready &&
      conversations.activeConversationId
    ) {
      saveConversationMessages(
        conversations.activeConversationId,
        messages,
      ).catch(() => undefined);
    }
  }, [
    conversations.activeConversationId,
    conversations.ready,
    localReady,
    messages,
    saveConversationMessages,
  ]);

  const stopGeneration = useCallback(() => {
    streamRef.current?.close();
    streamRef.current = null;
    setStreaming(false);
    setMessages(previous =>
      previous.map(message =>
        message.role === 'assistant' && message.status === 'streaming'
          ? {
              ...message,
              status: message.content ? 'partial' : 'stopped',
              updatedAt: Date.now(),
            }
          : message,
      ),
    );
  }, []);

  const updateSettings = useCallback(
    <K extends keyof ApiSettings>(key: K, value: ApiSettings[K]) => {
      setSettings(previous => ({...previous, [key]: value}));
    },
    [],
  );

  const persistSettings = useCallback(async () => {
    try {
      await Promise.all([
        saveSettings(settings),
        saveApiKey(apiKeyDraft),
        conversations.activeConversationId
          ? conversations.saveSettings(
              conversations.activeConversationId,
              settings,
            )
          : Promise.resolve(),
      ]);
      setApiKey(apiKeyDraft.trim());
      setStatus('Settings saved.');
      setSettingsOpen(false);
    } catch {
      setStatus('Could not save settings on this device.');
    }
  }, [apiKeyDraft, conversations, settings]);

  const startNewChat = useCallback(async () => {
    stopGeneration();
    const conversation = await conversations.createConversation(settings);
    setMessages(conversation.messages);
    setStatus('New conversation created.');
  }, [conversations, settings, stopGeneration]);

  const selectConversation = useCallback(
    async (id: string) => {
      stopGeneration();
      const conversation = await conversations.selectConversation(id);
      if (conversation) {
        setMessages(conversation.messages);
        setSettings(conversation.settingsSnapshot);
      }
    },
    [conversations, stopGeneration],
  );

  const sendMessage = useCallback(() => {
    const content = input.trim();
    if (!content || streaming) {
      return;
    }

    if (!apiKey.trim() || !settings.baseUrl.trim() || !settings.model.trim()) {
      setSettingsOpen(true);
      setStatus(
        'Add an API key, base URL, and model before sending a message.',
      );
      return;
    }

    const userMessage: ChatMessage = {
      id: makeId(),
      role: 'user',
      content,
      createdAt: Date.now(),
      status: 'completed',
    };
    const assistantMessage: ChatMessage = {
      id: makeId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      status: 'streaming',
    };
    const requestMessages = [
      ...(settings.systemPrompt.trim()
        ? [{role: 'system' as const, content: settings.systemPrompt.trim()}]
        : []),
      ...messages.map(message => ({
        role: message.role,
        content: message.content,
      })),
      {role: 'user' as const, content},
    ];

    setInput('');
    setStatus('');
    setMessages(previous => [...previous, userMessage, assistantMessage]);
    setStreaming(true);

    const stream = streamChatCompletion(
      settings,
      apiKey,
      requestMessages,
      delta => {
        setMessages(previous =>
          previous.map(message =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  content: message.content + delta,
                  status: 'streaming',
                  updatedAt: Date.now(),
                }
              : message,
          ),
        );
      },
    );
    streamRef.current = stream;

    stream.done
      .then(() => {
        setMessages(previous =>
          previous.map(message =>
            message.id === assistantMessage.id
              ? {...message, status: 'completed', updatedAt: Date.now()}
              : message,
          ),
        );
      })
      .catch(error => {
        setMessages(previous =>
          previous.map(message =>
            message.id === assistantMessage.id
              ? {
                  ...message,
                  status: message.content ? 'partial' : 'failed',
                  errorMessage:
                    error instanceof Error
                      ? error.message
                      : 'The API request failed.',
                  updatedAt: Date.now(),
                }
              : message,
          ),
        );
        setStatus(
          error instanceof Error ? error.message : 'The API request failed.',
        );
      })
      .finally(() => {
        streamRef.current = null;
        setStreaming(false);
      });
  }, [apiKey, input, messages, settings, streaming]);

  if (!localReady || !conversations.ready) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar
          barStyle="light-content"
          backgroundColor={colors.background}
        />
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.loadingText}>Loading MobiGPT…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" backgroundColor={colors.background} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>MobiGPT</Text>
            <Text style={styles.subtitle}>OpenAI-compatible mobile chat</Text>
          </View>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setSettingsOpen(previous => !previous)}
              style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Settings</Text>
            </Pressable>
          </View>
        </View>

        <ConversationPanel
          activeConversationId={conversations.activeConversationId}
          conversations={conversations.conversations}
          onDelete={id =>
            conversations
              .deleteConversation(id)
              .catch(() => setStatus('Could not delete conversation.'))
          }
          onDuplicate={id =>
            conversations
              .duplicateConversation(id)
              .catch(() => setStatus('Could not duplicate conversation.'))
          }
          onNew={startNewChat}
          onQueryChange={conversations.setQuery}
          onRename={(id, title) =>
            conversations
              .renameConversation(id, title)
              .catch(() => setStatus('Could not rename conversation.'))
          }
          onSelect={selectConversation}
          query={conversations.query}
        />

        {settingsOpen && (
          <View style={styles.settingsPanel}>
            <Text style={styles.sectionTitle}>Connection</Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onChangeText={value => updateSettings('baseUrl', value)}
              placeholder="https://api.openai.com/v1"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={settings.baseUrl}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setApiKeyDraft}
              placeholder="API key (stored in the device keychain)"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              value={apiKeyDraft}
            />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={value => updateSettings('model', value)}
              placeholder="Model name"
              placeholderTextColor={colors.muted}
              style={styles.input}
              value={settings.model}
            />
            <View style={styles.settingsRow}>
              <TextInput
                keyboardType="decimal-pad"
                onChangeText={value =>
                  updateSettings('temperature', Number(value) || 0)
                }
                placeholder="Temperature"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.halfInput]}
                value={String(settings.temperature)}
              />
              <TextInput
                keyboardType="number-pad"
                onChangeText={value =>
                  updateSettings('maxTokens', Number(value) || 1)
                }
                placeholder="Max tokens"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.halfInput]}
                value={String(settings.maxTokens)}
              />
            </View>
            <TextInput
              multiline
              onChangeText={value => updateSettings('systemPrompt', value)}
              placeholder="System prompt"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.promptInput]}
              value={settings.systemPrompt}
            />
            <Pressable
              accessibilityRole="button"
              onPress={persistSettings}
              style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Save settings</Text>
            </Pressable>
            <Text style={styles.securityNote}>
              For production use, prefer a trusted proxy so a provider key is
              not exposed directly from a mobile app.
            </Text>
          </View>
        )}

        {status ? <Text style={styles.status}>{status}</Text> : null}
        <FlatList
          contentContainerStyle={styles.messages}
          data={messages}
          keyExtractor={message => message.id}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Start a conversation</Text>
              <Text style={styles.emptyText}>
                Add your OpenAI-compatible endpoint and API key, then send a
                message.
              </Text>
            </View>
          }
          renderItem={({item}) => <MessageBubble message={item} />}
        />
        <View style={styles.composer}>
          <TextInput
            editable={!streaming}
            multiline
            onChangeText={setInput}
            onSubmitEditing={sendMessage}
            placeholder={
              streaming ? 'MobiGPT is responding…' : 'Message MobiGPT'
            }
            placeholderTextColor={colors.muted}
            returnKeyType="send"
            style={styles.composerInput}
            value={input}
          />
          <Pressable
            accessibilityRole="button"
            disabled={streaming ? false : !input.trim()}
            onPress={streaming ? stopGeneration : sendMessage}
            style={[
              styles.sendButton,
              !streaming && !input.trim() && styles.disabled,
            ]}>
            <Text style={styles.sendButtonText}>
              {streaming ? 'Stop' : 'Send'}
            </Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1},
  screen: {backgroundColor: colors.background, flex: 1},
  loadingScreen: {
    alignItems: 'center',
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: 'center',
  },
  loadingText: {color: colors.muted, marginTop: 12},
  header: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  title: {color: colors.text, fontSize: 22, fontWeight: '700'},
  subtitle: {color: colors.muted, fontSize: 12, marginTop: 2},
  headerActions: {flexDirection: 'row', gap: 8},
  headerButton: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  headerButtonText: {color: colors.text, fontSize: 12, fontWeight: '600'},
  settingsPanel: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    fontSize: 14,
    marginBottom: 8,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  settingsRow: {flexDirection: 'row', gap: 8},
  halfInput: {flex: 1},
  promptInput: {minHeight: 64, textAlignVertical: 'top'},
  primaryButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 8,
    paddingVertical: 10,
  },
  primaryButtonText: {color: '#08101e', fontWeight: '700'},
  securityNote: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 8,
  },
  status: {
    color: colors.danger,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  messages: {flexGrow: 1, padding: 16},
  emptyState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  emptyText: {color: colors.muted, lineHeight: 20, textAlign: 'center'},
  messageRow: {alignItems: 'flex-start', marginBottom: 12},
  messageRowUser: {alignItems: 'flex-end'},
  messageBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: '88%',
    padding: 12,
  },
  userBubble: {
    backgroundColor: colors.userBubble,
    borderColor: colors.userBubble,
  },
  messageRole: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  messageText: {color: colors.text, fontSize: 15, lineHeight: 21},
  errorText: {color: colors.danger, fontSize: 12, marginTop: 6},
  composer: {
    alignItems: 'flex-end',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  composerInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 15,
  },
  sendButtonText: {color: '#08101e', fontWeight: '700'},
  disabled: {backgroundColor: colors.border},
});
