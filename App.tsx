import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  Image,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import {ConversationPanel} from './src/components/ConversationPanel';
import {MarkdownMessage} from './src/components/MarkdownMessage';
import {ProviderPanel} from './src/components/ProviderPanel';
import {PrivacyPanel} from './src/components/PrivacyPanel';
import {AttachmentPicker} from './src/components/AttachmentPicker';
import {VoiceControls} from './src/components/VoiceControls';
import {OfflinePanel} from './src/components/OfflinePanel';
import {streamChatCompletion, ChatStream} from './src/api/openai';
import {loadApiKey, loadSettings} from './src/storage';
import {useConversations} from './src/chat/useConversations';
import {useProviders} from './src/providers/useProviders';
import {providerToApiSettings} from './src/providers/providerProfiles';
import {usePrivacyLock} from './src/privacy/usePrivacy';
import {
  exportConversations,
  importConversations,
  isDocumentPickerCancelled,
} from './src/privacy/dataTransfer';
import {clearAllLocalData} from './src/storage';
import {useVoice} from './src/voice/useVoice';
import {useOfflineQueue} from './src/offline/useOfflineQueue';
import {loadDrafts, saveDraft} from './src/offline/queue';
import {
  appendAssistantDelta,
  buildRequestMessages,
  clearAssistantResponse,
  deleteMessage,
  editUserMessage,
  markAssistantCompleted,
  markAssistantFailed,
  markAssistantStopped,
  prepareRegeneration,
  prepareRetry,
} from './src/chat/messageState';
import {
  ApiSettings,
  ChatMessage,
  DEFAULT_SETTINGS,
  ImageAttachment,
} from './src/types';

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

function MessageBubble({
  message,
  onCopy,
  onDelete,
  onClear,
  onRetry,
  onRegenerate,
  onEdit,
}: {
  message: ChatMessage;
  onCopy: (message: ChatMessage) => void;
  onDelete: (message: ChatMessage) => void;
  onClear: (message: ChatMessage) => void;
  onRetry: (message: ChatMessage) => void;
  onRegenerate: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
}) {
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
        <MarkdownMessage content={message.content || '…'} />
        {message.contentParts
          ?.flatMap(part => (part.type === 'image' ? [part] : []))
          .map(part => (
            <Image
              key={part.image.id}
              accessibilityLabel="Image attachment"
              source={{uri: part.image.uri}}
              style={styles.messageImage}
            />
          ))}
        {message.errorMessage ? (
          <Text style={styles.errorText}>{message.errorMessage}</Text>
        ) : null}
        <View style={styles.messageActions}>
          <Pressable
            accessibilityLabel="Copy message"
            onPress={() => onCopy(message)}>
            <Text style={styles.actionText}>Copy</Text>
          </Pressable>
          {isUser ? (
            <Pressable
              accessibilityLabel="Edit and resend message"
              onPress={() => onEdit(message)}>
              <Text style={styles.actionText}>Edit</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                accessibilityLabel="Regenerate response"
                onPress={() => onRegenerate(message)}>
                <Text style={styles.actionText}>Regenerate</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Retry response"
                onPress={() => onRetry(message)}>
                <Text style={styles.actionText}>Retry</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Clear response"
                onPress={() => onClear(message)}>
                <Text style={styles.actionText}>Clear</Text>
              </Pressable>
            </>
          )}
          <Pressable
            accessibilityLabel="Delete message"
            onPress={() => onDelete(message)}>
            <Text style={[styles.actionText, styles.deleteAction]}>Delete</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

export default function App() {
  const [settings, setSettings] = useState<ApiSettings>(DEFAULT_SETTINGS);
  const [apiKey, setApiKey] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [status, setStatus] = useState('');
  const streamRef = useRef<ChatStream | null>(null);
  const generationIdRef = useRef(0);
  const assistantIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [followingLatest, setFollowingLatest] = useState(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<
    ImageAttachment[]
  >([]);
  const [attachmentWarningAccepted, setAttachmentWarningAccepted] =
    useState(false);
  const [offlinePanelOpen, setOfflinePanelOpen] = useState(false);
  const [offlineQueueEnabled, setOfflineQueueEnabled] = useState(false);
  const conversations = useConversations();
  const providers = useProviders();
  const privacy = usePrivacyLock();
  const voice = useVoice();
  const offline = useOfflineQueue();

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
  const activeProvider = providers.activeProfile;

  useEffect(() => {
    if (!providers.ready || !activeProvider) {
      return;
    }
    setSettings(providerToApiSettings(activeProvider));
    setApiKey(providers.apiKey);
  }, [activeProvider, providers.apiKey, providers.ready]);

  useEffect(() => {
    if (!conversations.ready || !activeConversation) {
      return;
    }
    setMessages(activeConversation.messages);
    setSettings(activeConversation.settingsSnapshot);
    loadDrafts()
      .then(drafts => setInput(drafts[activeConversation.id] ?? ''))
      .catch(() => setInput(''));
    setStatus('');
  }, [activeConversation, conversations.ready]);

  useEffect(() => {
    if (
      localReady &&
      conversations.ready &&
      conversations.activeConversationId
    ) {
      saveDraft(conversations.activeConversationId, input).catch(
        () => undefined,
      );
    }
  }, [
    conversations.activeConversationId,
    conversations.ready,
    input,
    localReady,
  ]);

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
    generationIdRef.current += 1;
    streamRef.current?.close();
    streamRef.current = null;
    const assistantId = assistantIdRef.current;
    assistantIdRef.current = null;
    if (assistantId) {
      setMessages(previous => markAssistantStopped(previous, assistantId));
    }
    setStreaming(false);
  }, []);

  const saveProviderProfile = useCallback(
    async (
      profile: Parameters<typeof providers.updateProvider>[0],
      nextApiKey: string,
    ) => {
      const saved = await providers.updateProvider(profile, nextApiKey);
      const nextSettings = providerToApiSettings(saved);
      setSettings(nextSettings);
      setApiKey(nextApiKey.trim());
      if (conversations.activeConversationId) {
        await conversations.saveSettings(
          conversations.activeConversationId,
          nextSettings,
        );
      }
      setStatus('Provider profile saved.');
    },
    [conversations, providers],
  );

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

  const startGeneration = useCallback(
    (
      prompt: string,
      baseMessages: ChatMessage[],
      existingAssistantId?: string,
      appendUser = true,
      attachments: ImageAttachment[] = [],
    ) => {
      if (
        !apiKey.trim() ||
        !settings.baseUrl.trim() ||
        !settings.model.trim()
      ) {
        setSettingsOpen(true);
        setStatus(
          'Add an API key, base URL, and model before sending a message.',
        );
        return;
      }

      const assistantId = existingAssistantId ?? makeId();
      const userMessage: ChatMessage = {
        id: makeId(),
        role: 'user',
        content: prompt,
        ...(attachments.length
          ? {
              contentParts: [
                {type: 'text' as const, text: prompt},
                ...attachments.map(attachment => ({
                  type: 'image' as const,
                  image: attachment,
                })),
              ],
            }
          : {}),
        createdAt: Date.now(),
        status: 'completed',
      };
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'streaming',
      };
      const requestBase = existingAssistantId
        ? baseMessages.filter(message => message.id !== existingAssistantId)
        : baseMessages;
      const requestMessages = buildRequestMessages(
        requestBase,
        settings.systemPrompt,
        appendUser ? prompt : undefined,
        appendUser ? userMessage.contentParts : undefined,
      );
      const nextMessages = existingAssistantId
        ? baseMessages.map(message =>
            message.id === existingAssistantId ? assistantMessage : message,
          )
        : [
            ...baseMessages,
            ...(appendUser ? [userMessage] : []),
            assistantMessage,
          ];

      const generationId = generationIdRef.current + 1;
      generationIdRef.current = generationId;
      assistantIdRef.current = assistantId;
      setStatus('');
      setMessages(nextMessages);
      setStreaming(true);

      const stream = streamChatCompletion(
        settings,
        apiKey,
        requestMessages,
        delta => {
          if (generationId !== generationIdRef.current) {
            return;
          }
          setMessages(previous =>
            appendAssistantDelta(previous, assistantId, delta),
          );
        },
      );
      streamRef.current = stream;

      stream.done
        .then(() => {
          if (generationId === generationIdRef.current) {
            setMessages(previous =>
              markAssistantCompleted(previous, assistantId),
            );
          }
        })
        .catch(error => {
          if (generationId !== generationIdRef.current) {
            return;
          }
          const message =
            error instanceof Error ? error.message : 'The API request failed.';
          setMessages(previous =>
            markAssistantFailed(previous, assistantId, message),
          );
          setStatus(message);
        })
        .finally(() => {
          if (generationId === generationIdRef.current) {
            streamRef.current = null;
            assistantIdRef.current = null;
            setStreaming(false);
          }
        });
    },
    [apiKey, settings],
  );

  const offlineFlushRef = useRef(false);

  useEffect(() => {
    if (
      !offline.connected ||
      !offlineQueueEnabled ||
      !offline.queue.length ||
      offlineFlushRef.current
    ) {
      return;
    }
    offlineFlushRef.current = true;
    offline
      .flush(async item => {
        const conversation = await conversations.selectConversation(
          item.conversationId,
        );
        if (!conversation) {
          throw new Error('Queued conversation no longer exists.');
        }
        setMessages(conversation.messages);
        startGeneration(item.prompt, conversation.messages);
        const stream = streamRef.current;
        if (!stream) {
          throw new Error('Queued provider stream could not start.');
        }
        await stream.done;
      })
      .catch(() => undefined)
      .finally(() => {
        offlineFlushRef.current = false;
      });
  }, [conversations, offline, offlineQueueEnabled, startGeneration]);

  const sendMessage = useCallback(() => {
    const content = input.trim();
    if ((!content && !pendingAttachments.length) || streaming) {
      return;
    }
    if (!offline.connected) {
      if (
        offlineQueueEnabled &&
        conversations.activeConversationId &&
        content
      ) {
        offline
          .queueSend(conversations.activeConversationId, content)
          .then(() => {
            setInput('');
            setStatus(
              'Prompt queued. It will be sent when connectivity returns.',
            );
          })
          .catch(error =>
            setStatus(
              error instanceof Error
                ? error.message
                : 'Could not queue prompt.',
            ),
          );
      } else {
        setStatus(
          'You are offline. Conversation browsing remains available, but remote generation is unavailable.',
        );
      }
      return;
    }
    if (pendingAttachments.length && !attachmentWarningAccepted) {
      Alert.alert(
        'Send image to provider?',
        'The selected provider may receive this image and the conversation. Continue only if you trust the endpoint.',
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Continue', onPress: () => setAttachmentWarningAccepted(true)},
        ],
      );
      return;
    }
    if (editingMessageId) {
      const edited = editUserMessage(messages, editingMessageId, content);
      if (edited.prompt) {
        setEditingMessageId(null);
        setInput('');
        setMessages(edited.messages);
        startGeneration(content, edited.messages, undefined, false);
      }
      return;
    }
    setInput('');
    const attachments = pendingAttachments;
    setPendingAttachments([]);
    startGeneration(content, messages, undefined, true, attachments);
  }, [
    attachmentWarningAccepted,
    conversations.activeConversationId,
    editingMessageId,
    input,
    messages,
    offline,
    offlineQueueEnabled,
    pendingAttachments,
    startGeneration,
    streaming,
  ]);

  const copyMessage = useCallback((message: ChatMessage) => {
    Clipboard.setString(message.content);
    setStatus('Message copied.');
  }, []);

  const deleteChatMessage = useCallback(
    (message: ChatMessage) => {
      if (message.id === assistantIdRef.current) {
        stopGeneration();
      }
      setMessages(previous => deleteMessage(previous, message.id));
    },
    [stopGeneration],
  );

  const clearChatResponse = useCallback((message: ChatMessage) => {
    setMessages(previous => clearAssistantResponse(previous, message.id));
  }, []);

  const retryResponse = useCallback(
    (message: ChatMessage) => {
      if (streaming) {
        stopGeneration();
      }
      const prepared = prepareRetry(messages, message.id);
      if (prepared.prompt) {
        setMessages(prepared.messages);
        startGeneration(
          prepared.prompt.content,
          prepared.messages,
          message.id,
          false,
        );
      }
    },
    [messages, startGeneration, stopGeneration, streaming],
  );

  const regenerateResponse = useCallback(
    (message: ChatMessage) => {
      if (streaming) {
        stopGeneration();
      }
      const prepared = prepareRegeneration(messages, message.id);
      if (prepared.prompt) {
        setMessages(prepared.messages);
        startGeneration(
          prepared.prompt.content,
          prepared.messages,
          message.id,
          false,
        );
      }
    },
    [messages, startGeneration, stopGeneration, streaming],
  );

  const editChatMessage = useCallback(
    (message: ChatMessage) => {
      if (streaming) {
        stopGeneration();
      }
      setEditingMessageId(message.id);
      setInput(message.content);
      setStatus('Edit the prompt, then press Send to resend it.');
    },
    [stopGeneration, streaming],
  );

  const handleImport = useCallback(async () => {
    try {
      const imported = await importConversations();
      if (imported) {
        const active = imported.conversations.find(
          conversation => conversation.id === imported.activeConversationId,
        );
        setMessages(
          active?.messages ?? imported.conversations[0]?.messages ?? [],
        );
        setStatus('Conversations imported.');
      }
    } catch (error) {
      if (!isDocumentPickerCancelled(error)) {
        setStatus(
          error instanceof Error
            ? error.message
            : 'Could not import conversations.',
        );
      }
    }
  }, []);

  const handleClearAll = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        Alert.alert(
          'Clear all local data?',
          'This deletes conversations, drafts, provider profiles, cached metadata, and stored API keys from this device.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
              onPress: () => reject(new Error('Cancelled.')),
            },
            {
              text: 'Clear all',
              style: 'destructive',
              onPress: () => {
                clearAllLocalData()
                  .then(() => {
                    setMessages([]);
                    setStatus('All local data cleared.');
                    resolve();
                  })
                  .catch(reject);
              },
            },
          ],
        );
      }),
    [],
  );

  if (
    !localReady ||
    !conversations.ready ||
    !providers.ready ||
    !privacy.ready
  ) {
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

  if (privacy.locked) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <StatusBar
          barStyle="light-content"
          backgroundColor={colors.background}
        />
        <Text style={styles.lockTitle}>MobiGPT is locked</Text>
        <Text style={styles.loadingText}>
          Unlock to view local conversations and provider settings.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => privacy.unlock().catch(() => undefined)}
          style={styles.primaryButton}>
          <Text style={styles.primaryButtonText}>
            Unlock with {privacy.type ?? 'device security'}
          </Text>
        </Pressable>
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
            <Pressable
              accessibilityRole="button"
              onPress={() => setPrivacyOpen(previous => !previous)}
              style={styles.headerButton}>
              <Text style={styles.headerButtonText}>Privacy</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setOfflinePanelOpen(previous => !previous)}
              style={styles.headerButton}>
              <Text style={styles.headerButtonText}>
                {offline.connected ? 'Offline' : 'Offline!'}
              </Text>
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
          <ProviderPanel
            activeApiKey={providers.apiKey}
            activeProfile={providers.activeProfile}
            firstRun={providers.firstRun}
            onCreate={providers.createProvider}
            onDeleteKey={providers.removeApiKey}
            onDiscover={async (profile, key) =>
              (await providers.discoverModels(profile, key)).map(
                model => model.id,
              )
            }
            onSave={saveProviderProfile}
            onSelect={providers.selectProvider}
            onTest={providers.testConnection}
            profiles={providers.profiles}
          />
        )}

        {privacyOpen && (
          <PrivacyPanel
            biometricEnabled={privacy.enabled}
            biometricSupported={privacy.supported}
            biometricType={privacy.type}
            onClearAll={handleClearAll}
            onDisableBiometric={privacy.disable}
            onEnableBiometric={privacy.enable}
            onExport={exportConversations}
            onImport={handleImport}
          />
        )}

        {offlinePanelOpen && (
          <OfflinePanel
            connected={offline.connected}
            onCancel={offline.cancelQueuedSend}
            onToggleQueue={setOfflineQueueEnabled}
            queue={offline.queue}
            queueEnabled={offlineQueueEnabled}
          />
        )}

        {status ? <Text style={styles.status}>{status}</Text> : null}
        <View style={styles.messageListContainer}>
          <FlatList
            ref={listRef}
            contentContainerStyle={styles.messages}
            data={messages}
            keyExtractor={message => message.id}
            onContentSizeChange={() => {
              if (followingLatest) {
                listRef.current?.scrollToEnd({animated: true});
              }
            }}
            onScroll={event => {
              const {contentOffset, contentSize, layoutMeasurement} =
                event.nativeEvent;
              setFollowingLatest(
                contentOffset.y + layoutMeasurement.height >=
                  contentSize.height - 48,
              );
            }}
            scrollEventThrottle={16}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>Start a conversation</Text>
                <Text style={styles.emptyText}>
                  Add your OpenAI-compatible endpoint and API key, then send a
                  message.
                </Text>
              </View>
            }
            renderItem={({item}) => (
              <MessageBubble
                message={item}
                onClear={clearChatResponse}
                onCopy={copyMessage}
                onDelete={deleteChatMessage}
                onEdit={editChatMessage}
                onRegenerate={regenerateResponse}
                onRetry={retryResponse}
              />
            )}
          />
          {!followingLatest && messages.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to latest message"
              onPress={() => {
                listRef.current?.scrollToEnd({animated: true});
                setFollowingLatest(true);
              }}
              style={styles.jumpButton}>
              <Text style={styles.jumpButtonText}>Jump to latest</Text>
            </Pressable>
          ) : null}
        </View>
        <VoiceControls
          available={voice.available}
          onCancel={voice.cancelRecording}
          onSpeak={() =>
            voice.speak(
              [...messages]
                .reverse()
                .find(message => message.role === 'assistant')?.content ?? '',
            )
          }
          onStart={voice.startRecording}
          onStop={async () => {
            const transcript = await voice.stopRecording();
            if (transcript)
              setInput(
                previous => `${previous}${previous ? ' ' : ''}${transcript}`,
              );
          }}
          onStopSpeaking={voice.stopSpeaking}
          onUseTranscript={() => {
            setInput(
              previous =>
                `${previous}${previous ? ' ' : ''}${voice.transcript}`,
            );
            voice.clearTranscript();
          }}
          recording={voice.recording}
          speaking={voice.speaking}
          transcript={voice.transcript}
        />
        <AttachmentPicker
          attachments={pendingAttachments}
          disabled={streaming}
          onAdd={attachment => {
            setPendingAttachments(previous => [...previous, attachment]);
            setAttachmentWarningAccepted(false);
          }}
          onError={setStatus}
          onRemove={id =>
            setPendingAttachments(previous =>
              previous.filter(attachment => attachment.id !== id),
            )
          }
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
            disabled={
              streaming ? false : !input.trim() && !pendingAttachments.length
            }
            onPress={streaming ? stopGeneration : sendMessage}
            style={[
              styles.sendButton,
              !streaming &&
                !input.trim() &&
                !pendingAttachments.length &&
                styles.disabled,
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
  loadingText: {color: colors.muted, marginTop: 12, textAlign: 'center'},
  lockTitle: {color: colors.text, fontSize: 20, fontWeight: '700'},
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
  messageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  actionText: {color: colors.accent, fontSize: 10},
  deleteAction: {color: colors.danger},
  messageListContainer: {flex: 1},
  jumpButton: {
    alignSelf: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.accent,
    borderRadius: 16,
    borderWidth: 1,
    bottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'absolute',
  },
  jumpButtonText: {color: colors.accent, fontSize: 11, fontWeight: '700'},
  errorText: {color: colors.danger, fontSize: 12, marginTop: 6},
  messageImage: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 180,
    marginTop: 8,
    maxWidth: '100%',
    width: 240,
  },
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
