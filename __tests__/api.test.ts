jest.mock('react-native-sse', () => jest.fn());

import EventSource from 'react-native-sse';

import {streamChatCompletion} from '../src/api/openai';
import {DEFAULT_SETTINGS} from '../src/types';

type MockSource = {
  addEventListener: jest.Mock;
  removeAllEventListeners: jest.Mock;
  close: jest.Mock;
  listeners: Record<string, (event: unknown) => void>;
};

function createMockSource(): MockSource {
  const source: MockSource = {
    addEventListener: jest.fn((type, listener) => {
      source.listeners[type] = listener;
    }),
    removeAllEventListeners: jest.fn(),
    close: jest.fn(),
    listeners: {},
  };
  return source;
}

describe('streamChatCompletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends an OpenAI-compatible POST and emits streamed deltas', async () => {
    const source = createMockSource();
    (EventSource as jest.Mock).mockReturnValue(source);
    const deltas: string[] = [];

    const stream = streamChatCompletion(
      {...DEFAULT_SETTINGS, baseUrl: 'https://example.test/v1/'},
      'sk-test',
      [{role: 'user', content: 'Hello'}],
      delta => deltas.push(delta),
    );

    expect(EventSource).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        pollingInterval: 0,
        headers: expect.objectContaining({Authorization: 'Bearer sk-test'}),
        body: expect.stringContaining('"stream":true'),
      }),
    );

    source.listeners.message({
      data: JSON.stringify({choices: [{delta: {content: 'Hi'}}]}),
    });
    source.listeners.message({data: '[DONE]'});

    await stream.done;
    expect(deltas).toEqual(['Hi']);
    expect(source.close).toHaveBeenCalled();
  });
});
