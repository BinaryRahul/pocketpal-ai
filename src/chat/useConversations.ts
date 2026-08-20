import {useCallback, useEffect, useMemo, useReducer, useState} from 'react';

import {
  createStoredConversation,
  deleteStoredConversation,
  duplicateStoredConversation,
  loadConversationStore,
  saveConversationStore,
  updateConversation,
} from '../storage';
import {ApiSettings, ChatMessage, Conversation} from '../types';
import {
  INITIAL_CONVERSATION_LIST_STATE,
  conversationListReducer,
  filterConversations,
  getActiveConversation,
} from './conversationState';

export type UseConversationsResult = {
  ready: boolean;
  conversations: Conversation[];
  activeConversation?: Conversation;
  activeConversationId?: string;
  query: string;
  setQuery: (query: string) => void;
  selectConversation: (id: string) => Promise<Conversation | null>;
  createConversation: (settings: ApiSettings) => Promise<Conversation>;
  renameConversation: (
    id: string,
    title: string,
  ) => Promise<Conversation | null>;
  duplicateConversation: (id: string) => Promise<Conversation | null>;
  deleteConversation: (id: string) => Promise<void>;
  saveMessages: (id: string, messages: ChatMessage[]) => Promise<void>;
  saveSettings: (id: string, settings: ApiSettings) => Promise<void>;
};

export function useConversations(): UseConversationsResult {
  const [state, dispatch] = useReducer(
    conversationListReducer,
    INITIAL_CONVERSATION_LIST_STATE,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadConversationStore()
      .then(store => {
        if (mounted) {
          dispatch({type: 'hydrate', store});
          setReady(true);
        }
      })
      .catch(() => {
        if (mounted) {
          setReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const visibleConversations = useMemo(
    () => filterConversations(state.conversations, state.query),
    [state.conversations, state.query],
  );

  const selectConversation = useCallback(
    async (id: string): Promise<Conversation | null> => {
      const conversation = state.conversations.find(item => item.id === id);
      if (!conversation) {
        return null;
      }
      dispatch({type: 'select', id});
      await saveConversationStore({
        schemaVersion: 2,
        conversations: state.conversations,
        activeConversationId: id,
      });
      return conversation;
    },
    [state.conversations],
  );

  const createConversation = useCallback(async (settings: ApiSettings) => {
    const conversation = await createStoredConversation(settings);
    dispatch({type: 'upsert', conversation});
    return conversation;
  }, []);

  const renameConversation = useCallback(async (id: string, title: string) => {
    const conversation = await updateConversation(id, {title});
    if (conversation) {
      dispatch({type: 'upsert', conversation});
    }
    return conversation;
  }, []);

  const duplicateConversation = useCallback(async (id: string) => {
    const conversation = await duplicateStoredConversation(id);
    if (conversation) {
      dispatch({type: 'upsert', conversation});
    }
    return conversation;
  }, []);

  const deleteConversation = useCallback(async (id: string) => {
    await deleteStoredConversation(id);
    const replacement = await loadConversationStore();
    dispatch({type: 'hydrate', store: replacement});
  }, []);

  const saveMessages = useCallback(
    async (id: string, messages: ChatMessage[]) => {
      const conversation = await updateConversation(id, {messages});
      if (conversation) {
        dispatch({type: 'upsert', conversation});
      }
    },
    [],
  );

  const saveSettings = useCallback(
    async (id: string, settings: ApiSettings) => {
      const conversation = await updateConversation(id, {
        settingsSnapshot: settings,
      });
      if (conversation) {
        dispatch({type: 'upsert', conversation});
      }
    },
    [],
  );

  return {
    ready,
    conversations: visibleConversations,
    activeConversation: getActiveConversation(state),
    activeConversationId: state.activeConversationId,
    query: state.query,
    setQuery: query => dispatch({type: 'set-query', query}),
    selectConversation,
    createConversation,
    renameConversation,
    duplicateConversation,
    deleteConversation,
    saveMessages,
    saveSettings,
  };
}
