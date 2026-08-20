jest.mock('react-native-sse', () => jest.fn());

import EventSource from 'react-native-sse';

import {OpenAICompatibleProvider, ProviderError} from '../src/api/provider';
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

const request = {
  settings: {
    ...DEFAULT_SETTINGS,
    baseUrl: 'https://example.test/v1',
    requestTimeoutMs: 1_000,
  },
  apiKey: 'sk-test',
  messages: [{role: 'user' as const, content: 'Hello'}],
};

describe('OpenAI-compatible provider adapter', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    globalThis.fetch = jest.fn();
  });

  it('ignores empty keepalives and captures usage and finish reason', async () => {
    const source = createMockSource();
    (EventSource as jest.Mock).mockReturnValue(source);
    const provider = new OpenAICompatibleProvider();
    const deltas: string[] = [];
    const stream = provider.stream(request, delta => deltas.push(delta));

    source.listeners.message({data: ''});
    source.listeners.message({data: '   '});
    source.listeners.message({
      data: JSON.stringify({choices: [{delta: {content: 'Hi'}}]}),
    });
    source.listeners.message({
      data: JSON.stringify({
        choices: [{delta: {}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 3, completion_tokens: 2, total_tokens: 5},
      }),
    });
    source.listeners.message({data: '[DONE]'});

    await expect(stream.done).resolves.toBeUndefined();
    await expect(stream.result).resolves.toEqual({
      finishReason: 'stop',
      usage: {promptTokens: 3, completionTokens: 2, totalTokens: 5},
    });
    expect(deltas).toEqual(['Hi']);
  });

  it('normalizes malformed stream data as a parse error', async () => {
    const source = createMockSource();
    (EventSource as jest.Mock).mockReturnValue(source);
    const stream = new OpenAICompatibleProvider().stream(request, jest.fn());
    source.listeners.message({data: '{not-json'});
    await expect(stream.done).rejects.toMatchObject({
      details: {kind: 'unknown', retryable: false},
    });
    await expect(stream.result).rejects.toMatchObject({
      details: {kind: 'unknown'},
    });
  });

  it('normalizes provider authentication errors', async () => {
    const source = createMockSource();
    (EventSource as jest.Mock).mockReturnValue(source);
    const stream = new OpenAICompatibleProvider().stream(request, jest.fn());
    source.listeners.message({
      data: JSON.stringify({error: {message: 'Invalid API key'}}),
    });
    await expect(stream.done).rejects.toMatchObject({
      message: 'Invalid API key',
    });
    await expect(stream.result).rejects.toMatchObject({
      message: 'Invalid API key',
    });
  });

  it('rejects cancellation distinctly and closes the source', async () => {
    const source = createMockSource();
    (EventSource as jest.Mock).mockReturnValue(source);
    const stream = new OpenAICompatibleProvider().stream(request, jest.fn());
    stream.close();
    await expect(stream.done).rejects.toMatchObject({
      details: {kind: 'cancelled', retryable: false},
    });
    await expect(stream.result).rejects.toMatchObject({
      details: {kind: 'cancelled'},
    });
    expect(source.close).toHaveBeenCalled();
  });

  it('supports non-streaming fallback and captures the response body', async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          choices: [{message: {content: 'Fallback'}, finish_reason: 'stop'}],
          usage: {total_tokens: 4},
        }),
    });
    const deltas: string[] = [];
    const stream = new OpenAICompatibleProvider().stream(
      {...request, settings: {...request.settings, stream: false}},
      delta => deltas.push(delta),
    );
    await expect(stream.done).resolves.toBeUndefined();
    await expect(stream.result).resolves.toEqual({
      finishReason: 'stop',
      usage: {totalTokens: 4},
    });
    expect(deltas).toEqual(['Fallback']);
  });

  it('retries transient stream connection loss with bounded backoff', async () => {
    jest.useFakeTimers();
    const first = createMockSource();
    const second = createMockSource();
    (EventSource as jest.Mock)
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const stream = new OpenAICompatibleProvider().stream(request, jest.fn());
    first.listeners.error({message: 'network connection lost'});
    await jest.advanceTimersByTimeAsync(250);
    second.listeners.message({data: '[DONE]'});
    await expect(stream.done).resolves.toBeUndefined();
    expect(EventSource).toHaveBeenCalledTimes(2);
  });

  it('times out a stream when no provider event arrives', async () => {
    jest.useFakeTimers();
    const source = createMockSource();
    (EventSource as jest.Mock).mockReturnValue(source);
    const stream = new OpenAICompatibleProvider().stream(
      {...request, settings: {...request.settings, requestTimeoutMs: 50}},
      jest.fn(),
    );
    const donePromise = stream.done.catch(error => error);
    const resultPromise = stream.result.catch(error => error);
    await jest.advanceTimersByTimeAsync(50);
    expect(await donePromise).toBeInstanceOf(ProviderError);
    expect(await resultPromise).toMatchObject({details: {kind: 'timeout'}});
  });
});
