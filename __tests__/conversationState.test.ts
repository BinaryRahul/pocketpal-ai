import {
  conversationListReducer,
  filterConversations,
  getActiveConversation,
} from '../src/chat/conversationState';
import {Conversation} from '../src/types';

function conversation(
  id: string,
  title: string,
  updatedAt: number,
  content = '',
): Conversation {
  return {
    id,
    title,
    messages: content
      ? [{id: `${id}-message`, role: 'user', content, createdAt: updatedAt}]
      : [],
    createdAt: updatedAt,
    updatedAt,
    settingsSnapshot: {
      baseUrl: 'https://example.test/v1',
      model: 'test-model',
      temperature: 0.5,
      maxTokens: 100,
      systemPrompt: '',
    },
  };
}

describe('conversation list state', () => {
  it('sorts by most recently updated and searches titles and message content', () => {
    const conversations = [
      conversation('old', 'Older', 1, 'nothing'),
      conversation('new', 'Latest', 3, 'needle in the transcript'),
      conversation('middle', 'Middle', 2),
    ];

    expect(filterConversations(conversations, '').map(item => item.id)).toEqual(
      ['new', 'middle', 'old'],
    );
    expect(
      filterConversations(conversations, 'needle').map(item => item.id),
    ).toEqual(['new']);
    expect(
      filterConversations(conversations, 'middle').map(item => item.id),
    ).toEqual(['middle']);
  });

  it('hydrates, selects, upserts, and removes active sessions predictably', () => {
    const first = conversation('first', 'First', 1);
    const second = conversation('second', 'Second', 2);
    let state = conversationListReducer(
      {conversations: [], query: ''},
      {
        type: 'hydrate',
        store: {
          schemaVersion: 2,
          conversations: [first, second],
          activeConversationId: 'first',
        },
      },
    );
    expect(state.activeConversationId).toBe('first');
    expect(getActiveConversation(state)?.id).toBe('first');

    state = conversationListReducer(state, {type: 'select', id: 'second'});
    expect(state.activeConversationId).toBe('second');

    const renamed = {...second, title: 'Renamed', updatedAt: 10};
    state = conversationListReducer(state, {
      type: 'upsert',
      conversation: renamed,
    });
    expect(state.conversations.find(item => item.id === 'second')?.title).toBe(
      'Renamed',
    );

    state = conversationListReducer(state, {type: 'remove', id: 'second'});
    expect(state.activeConversationId).toBe('first');
    expect(state.conversations).toHaveLength(1);
  });
});
