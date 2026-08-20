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
} from '../src/chat/messageState';
import {ChatMessage} from '../src/types';

const messages: ChatMessage[] = [
  {id: 'u1', role: 'user', content: 'First', createdAt: 1, status: 'completed'},
  {
    id: 'a1',
    role: 'assistant',
    content: 'Answer',
    createdAt: 2,
    status: 'completed',
  },
  {
    id: 'u2',
    role: 'user',
    content: 'Second',
    createdAt: 3,
    status: 'completed',
  },
  {id: 'a2', role: 'assistant', content: '', createdAt: 4, status: 'streaming'},
];

describe('message lifecycle helpers', () => {
  it('appends deltas and distinguishes completed, failed, partial, and stopped states', () => {
    const streaming = appendAssistantDelta(messages, 'a2', 'Partial');
    expect(streaming[3]).toMatchObject({
      content: 'Partial',
      status: 'streaming',
    });
    expect(
      markAssistantCompleted(streaming, 'a2', {finishReason: 'stop'})[3],
    ).toMatchObject({status: 'completed', finishReason: 'stop'});
    expect(
      markAssistantFailed(streaming, 'a2', 'Network down')[3],
    ).toMatchObject({status: 'partial', errorMessage: 'Network down'});
    expect(markAssistantStopped(streaming, 'a2')[3]).toMatchObject({
      status: 'partial',
    });
  });

  it('prepares retry and regeneration without duplicating the prompt', () => {
    const retry = prepareRetry(messages, 'a2');
    expect(retry.prompt?.content).toBe('Second');
    expect(retry.messages).toHaveLength(messages.length);
    expect(retry.messages.at(-1)).toMatchObject({
      id: 'a2',
      content: '',
      status: 'stopped',
    });

    const regenerated = prepareRegeneration(messages, 'a1');
    expect(regenerated.prompt?.content).toBe('First');
    expect(regenerated.messages).toHaveLength(2);
    expect(regenerated.messages.at(-1)).toMatchObject({
      id: 'a1',
      role: 'assistant',
      status: 'streaming',
    });
  });

  it('edits a user prompt by truncating the old turn and returns the edited prompt', () => {
    const edited = editUserMessage(messages, 'u1', 'Edited first');
    expect(edited.prompt?.content).toBe('Edited first');
    expect(edited.messages).toHaveLength(1);
    expect(edited.messages[0]).toMatchObject({
      id: 'u1',
      content: 'Edited first',
    });
  });

  it('clears and deletes responses without mutating the original array', () => {
    const cleared = clearAssistantResponse(messages, 'a1');
    expect(cleared).not.toBe(messages);
    expect(cleared[1]).toMatchObject({content: '', status: 'stopped'});
    expect(deleteMessage(messages, 'u1').map(message => message.id)).toEqual([
      'a1',
      'u2',
      'a2',
    ]);
  });

  it('builds a system-prompt-aware request history', () => {
    expect(buildRequestMessages(messages.slice(0, 2), 'Be concise.')).toEqual([
      {role: 'system', content: 'Be concise.'},
      {role: 'user', content: 'First'},
      {role: 'assistant', content: 'Answer'},
    ]);
    expect(buildRequestMessages(messages.slice(0, 1), '', 'Follow up')).toEqual(
      [
        {role: 'user', content: 'First'},
        {role: 'user', content: 'Follow up'},
      ],
    );
  });
});
