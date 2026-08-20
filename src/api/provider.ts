import EventSource from 'react-native-sse';

import {
  ApiSettings,
  ApiErrorKind,
  ChatUsage,
  ModelInfo,
  NormalizedApiError,
} from '../types';

export type ApiMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatRequest = {
  settings: ApiSettings;
  apiKey: string;
  messages: ApiMessage[];
};

export type ChatStreamResult = {
  usage?: ChatUsage;
  finishReason?: string;
};

export type ChatStream = {
  close: () => void;
  done: Promise<void>;
  result: Promise<ChatStreamResult>;
};

export interface ChatProvider {
  stream(request: ChatRequest, onDelta: (text: string) => void): ChatStream;
  listModels?(request: Omit<ChatRequest, 'messages'>): Promise<ModelInfo[]>;
}

export class ProviderError extends Error {
  readonly details: NormalizedApiError;

  constructor(details: NormalizedApiError) {
    super(details.message);
    this.name = 'ProviderError';
    this.details = details;
  }
}

type ChatCompletionPayload = {
  choices?: Array<{
    delta?: {content?: string | null};
    message?: {content?: string | null};
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {message?: string; type?: string; code?: string | number};
};

type StreamEvent = {
  data?: string | null;
  message?: string;
  error?: unknown;
  status?: number;
};

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 250;

function completionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('/chat/completions')
    ? normalized
    : `${normalized}/chat/completions`;
}

function modelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  return normalized.endsWith('/models') ? normalized : `${normalized}/models`;
}

function usageFromPayload(
  payload: ChatCompletionPayload,
): ChatUsage | undefined {
  if (!payload.usage) {
    return undefined;
  }
  return {
    ...(typeof payload.usage.prompt_tokens === 'number'
      ? {promptTokens: payload.usage.prompt_tokens}
      : {}),
    ...(typeof payload.usage.completion_tokens === 'number'
      ? {completionTokens: payload.usage.completion_tokens}
      : {}),
    ...(typeof payload.usage.total_tokens === 'number'
      ? {totalTokens: payload.usage.total_tokens}
      : {}),
  };
}

function errorKind(status?: number, message = ''): ApiErrorKind {
  if (status === 401 || status === 403) return 'authentication';
  if (status === 408 || /timeout|timed out/i.test(message)) return 'timeout';
  if (status === 429) return 'rate_limit';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (/network|connection|fetch|socket/i.test(message)) return 'network';
  return typeof status === 'number' && status >= 400
    ? 'configuration'
    : 'unknown';
}

function isRetryable(kind: ApiErrorKind, status?: number): boolean {
  return (
    kind === 'network' ||
    kind === 'timeout' ||
    kind === 'server' ||
    status === 408 ||
    status === 429
  );
}

function normalizeError(
  event: StreamEvent,
  fallback = 'The API connection failed.',
): ProviderError {
  let message = event.message || fallback;
  let status = event.status;
  if (event.data) {
    try {
      const payload = JSON.parse(event.data) as ChatCompletionPayload;
      if (payload.error?.message) {
        message = payload.error.message;
      }
    } catch {
      if (event.data.trim()) {
        message = event.data.trim();
      }
    }
  }
  if (event.error instanceof Error) {
    message = event.error.message;
  }
  const kind = errorKind(status, message);
  return new ProviderError({
    kind,
    message,
    ...(status ? {status} : {}),
    retryable: isRetryable(kind, status),
  });
}

function timeoutError(): ProviderError {
  return new ProviderError({
    kind: 'timeout',
    message: 'The provider request timed out.',
    retryable: true,
  });
}

function cancelledError(): ProviderError {
  return new ProviderError({
    kind: 'cancelled',
    message: 'The provider request was cancelled.',
    retryable: false,
  });
}

function requestBody(request: ChatRequest, stream: boolean): string {
  return JSON.stringify({
    model: request.settings.model.trim(),
    messages: request.messages,
    temperature: request.settings.temperature,
    max_tokens: request.settings.maxTokens,
    stream,
  });
}

function requestHeaders(apiKey: string): Record<string, string> {
  return {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    ...(apiKey.trim() ? {Authorization: `Bearer ${apiKey.trim()}`} : {}),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class OpenAICompatibleProvider implements ChatProvider {
  stream(request: ChatRequest, onDelta: (text: string) => void): ChatStream {
    if (request.settings.stream === false) {
      return this.nonStreaming(request, onDelta);
    }

    let settled = false;
    let cancelled = false;
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveDone!: () => void;
    let rejectDone!: (error: ProviderError) => void;
    let resolveResult!: (result: ChatStreamResult) => void;
    let rejectResult!: (error: ProviderError) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const result = new Promise<ChatStreamResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    let latestResult: ChatStreamResult = {};

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      source?.removeAllEventListeners();
      source?.close();
      source = null;
    };
    const complete = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveResult(latestResult);
      resolveDone();
    };
    const fail = (error: ProviderError) => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectResult(error);
      rejectDone(error);
    };

    const startAttempt = (attempt: number) => {
      if (settled || cancelled) return;
      cleanup();
      timer = setTimeout(
        () => fail(timeoutError()),
        request.settings.requestTimeoutMs ?? 30_000,
      );
      try {
        source = new EventSource(completionsUrl(request.settings.baseUrl), {
          method: 'POST',
          headers: {
            ...requestHeaders(request.apiKey),
            Accept: 'text/event-stream',
          },
          body: requestBody(request, true),
          pollingInterval: 0,
        });
      } catch (error) {
        const normalized = normalizeError(
          {error},
          'Could not open the provider connection.',
        );
        if (normalized.details.retryable && attempt < MAX_RETRIES) {
          delay(RETRY_BASE_MS * 2 ** attempt).then(() =>
            startAttempt(attempt + 1),
          );
        } else {
          fail(normalized);
        }
        return;
      }
      source.addEventListener('message', (event: StreamEvent) => {
        if (settled || !event.data || !event.data.trim()) return;
        if (event.data.trim() === '[DONE]') {
          complete();
          return;
        }
        try {
          const payload = JSON.parse(event.data) as ChatCompletionPayload;
          if (payload.error) {
            throw normalizeError({data: event.data});
          }
          const delta = payload.choices?.[0]?.delta?.content;
          if (delta) onDelta(delta);
          const finishReason = payload.choices?.[0]?.finish_reason;
          const usage = usageFromPayload(payload);
          latestResult = {
            ...(finishReason
              ? {finishReason}
              : latestResult.finishReason
                ? {finishReason: latestResult.finishReason}
                : {}),
            ...(usage
              ? {usage}
              : latestResult.usage
                ? {usage: latestResult.usage}
                : {}),
          };
        } catch (error) {
          const normalized =
            error instanceof ProviderError
              ? error
              : normalizeError(
                  {data: event.data},
                  'The API returned invalid stream data.',
                );
          fail(normalized);
        }
      });
      source.addEventListener('error', (event: unknown) => {
        const normalized = normalizeError(event as StreamEvent);
        if (
          normalized.details.retryable &&
          attempt < MAX_RETRIES &&
          !cancelled
        ) {
          cleanup();
          delay(RETRY_BASE_MS * 2 ** attempt).then(() =>
            startAttempt(attempt + 1),
          );
        } else {
          fail(normalized);
        }
      });
    };

    startAttempt(0);
    return {
      close: () => {
        if (settled) return;
        cancelled = true;
        fail(cancelledError());
      },
      done,
      result,
    };
  }

  private nonStreaming(
    request: ChatRequest,
    onDelta: (text: string) => void,
  ): ChatStream {
    let settled = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let resolveDone!: () => void;
    let rejectDone!: (error: ProviderError) => void;
    let resolveResult!: (result: ChatStreamResult) => void;
    let rejectResult!: (error: ProviderError) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    const result = new Promise<ChatStreamResult>((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const finish = (error?: ProviderError, output: ChatStreamResult = {}) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) {
        rejectDone(error);
        rejectResult(error);
      } else {
        resolveDone();
        resolveResult(output);
      }
    };
    controller = new AbortController();
    timer = setTimeout(() => {
      controller?.abort();
      finish(timeoutError());
    }, request.settings.requestTimeoutMs ?? 30_000);
    fetch(completionsUrl(request.settings.baseUrl), {
      method: 'POST',
      headers: requestHeaders(request.apiKey),
      body: requestBody(request, false),
      signal: controller.signal,
    })
      .then(async response => {
        const text = await response.text();
        let payload: ChatCompletionPayload;
        try {
          payload = JSON.parse(text) as ChatCompletionPayload;
        } catch {
          throw normalizeError(
            {status: response.status, data: text},
            'The provider returned invalid JSON.',
          );
        }
        if (!response.ok || payload.error) {
          throw normalizeError({status: response.status, data: text});
        }
        const content = payload.choices?.[0]?.message?.content ?? '';
        if (content) onDelta(content);
        finish(undefined, {
          finishReason: payload.choices?.[0]?.finish_reason ?? undefined,
          usage: usageFromPayload(payload),
        });
      })
      .catch(error => {
        if (settled) return;
        finish(
          error instanceof ProviderError ? error : normalizeError({error}),
        );
      });
    return {
      close: () => {
        if (settled) return;
        controller?.abort();
        finish(cancelledError());
      },
      done,
      result,
    };
  }

  async listModels(
    request: Omit<ChatRequest, 'messages'>,
  ): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      request.settings.requestTimeoutMs ?? 30_000,
    );
    try {
      const response = await fetch(modelsUrl(request.settings.baseUrl), {
        headers: requestHeaders(request.apiKey),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw normalizeError(
          {status: response.status, data: text},
          `Model discovery failed with HTTP ${response.status}.`,
        );
      }
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw normalizeError(
          {data: text},
          'Model discovery returned invalid JSON.',
        );
      }
      if (
        !payload ||
        typeof payload !== 'object' ||
        !Array.isArray((payload as {data?: unknown}).data)
      ) {
        return [];
      }
      return (payload as {data: unknown[]}).data.flatMap(item => {
        if (
          !item ||
          typeof item !== 'object' ||
          typeof (item as {id?: unknown}).id !== 'string'
        )
          return [];
        return [
          {
            id: (item as {id: string}).id,
            ...((item as {owned_by?: string}).owned_by
              ? {ownedBy: (item as {owned_by: string}).owned_by}
              : {}),
          },
        ];
      });
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw normalizeError({error}, 'Model discovery failed.');
    } finally {
      clearTimeout(timer);
    }
  }
}

export const openAICompatibleProvider = new OpenAICompatibleProvider();
