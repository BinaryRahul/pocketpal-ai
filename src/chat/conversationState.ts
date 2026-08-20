import {Conversation, ConversationStore} from '../types';

export type ConversationListState = {
  conversations: Conversation[];
  activeConversationId?: string;
  query: string;
};

export type ConversationListAction =
  | {type: 'hydrate'; store: ConversationStore}
  | {type: 'select'; id: string}
  | {type: 'set-query'; query: string}
  | {type: 'upsert'; conversation: Conversation}
  | {type: 'remove'; id: string};

export function sortConversations(
  conversations: Conversation[],
): Conversation[] {
  return [...conversations].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

export function filterConversations(
  conversations: Conversation[],
  query: string,
): Conversation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return sortConversations(conversations);
  }
  return sortConversations(conversations).filter(conversation => {
    if (conversation.title.toLocaleLowerCase().includes(normalizedQuery)) {
      return true;
    }
    return conversation.messages.some(message =>
      message.content.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}

export const INITIAL_CONVERSATION_LIST_STATE: ConversationListState = {
  conversations: [],
  query: '',
};

export function conversationListReducer(
  state: ConversationListState,
  action: ConversationListAction,
): ConversationListState {
  switch (action.type) {
    case 'hydrate':
      return {
        conversations: sortConversations(action.store.conversations),
        activeConversationId: action.store.activeConversationId,
        query: state.query,
      };
    case 'select':
      return state.conversations.some(
        conversation => conversation.id === action.id,
      )
        ? {...state, activeConversationId: action.id}
        : state;
    case 'set-query':
      return {...state, query: action.query};
    case 'upsert':
      return {
        ...state,
        conversations: sortConversations([
          ...state.conversations.filter(
            conversation => conversation.id !== action.conversation.id,
          ),
          action.conversation,
        ]),
        activeConversationId: action.conversation.id,
      };
    case 'remove': {
      const conversations = state.conversations.filter(
        conversation => conversation.id !== action.id,
      );
      const activeConversationId =
        state.activeConversationId === action.id
          ? conversations[0]?.id
          : state.activeConversationId;
      return {
        ...state,
        conversations: sortConversations(conversations),
        activeConversationId,
      };
    }
  }
}

export function getActiveConversation(
  state: ConversationListState,
): Conversation | undefined {
  return state.conversations.find(
    conversation => conversation.id === state.activeConversationId,
  );
}
