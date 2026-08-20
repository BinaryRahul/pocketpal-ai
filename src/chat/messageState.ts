import {ApiContentPart, ChatMessage, MessageContentPart} from '../types';

export function appendAssistantDelta(
  messages: ChatMessage[],
  messageId: string,
  delta: string,
): ChatMessage[] {
  return messages.map(message =>
    message.id === messageId
      ? {
          ...message,
          content: message.content + delta,
          status: 'streaming',
          updatedAt: Date.now(),
        }
      : message,
  );
}

export function markAssistantCompleted(
  messages: ChatMessage[],
  messageId: string,
  metadata: Pick<ChatMessage, 'finishReason' | 'usage'> = {},
): ChatMessage[] {
  return messages.map(message =>
    message.id === messageId
      ? {
          ...message,
          ...metadata,
          status: 'completed',
          updatedAt: Date.now(),
          errorMessage: undefined,
        }
      : message,
  );
}

export function markAssistantFailed(
  messages: ChatMessage[],
  messageId: string,
  errorMessage: string,
): ChatMessage[] {
  return messages.map(message =>
    message.id === messageId
      ? {
          ...message,
          status: message.content ? 'partial' : 'failed',
          errorMessage: errorMessage.slice(0, 4_000),
          updatedAt: Date.now(),
        }
      : message,
  );
}

export function markAssistantStopped(
  messages: ChatMessage[],
  messageId: string,
): ChatMessage[] {
  return messages.map(message =>
    message.id === messageId
      ? {
          ...message,
          status: message.content ? 'partial' : 'stopped',
          updatedAt: Date.now(),
          errorMessage: undefined,
        }
      : message,
  );
}

export function clearAssistantResponse(
  messages: ChatMessage[],
  assistantId: string,
): ChatMessage[] {
  return messages.map(message =>
    message.id === assistantId
      ? {
          ...message,
          content: '',
          status: 'stopped',
          errorMessage: undefined,
          finishReason: undefined,
          usage: undefined,
          updatedAt: Date.now(),
        }
      : message,
  );
}

export function deleteMessage(
  messages: ChatMessage[],
  messageId: string,
): ChatMessage[] {
  return messages.filter(message => message.id !== messageId);
}

export function findRetryUserMessage(
  messages: ChatMessage[],
  assistantId: string,
): ChatMessage | undefined {
  const assistantIndex = messages.findIndex(
    message => message.id === assistantId,
  );
  if (assistantIndex < 0) {
    return undefined;
  }
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      return messages[index];
    }
  }
  return undefined;
}

export function prepareRetry(
  messages: ChatMessage[],
  assistantId: string,
): {messages: ChatMessage[]; prompt?: ChatMessage} {
  const prompt = findRetryUserMessage(messages, assistantId);
  return {
    messages: clearAssistantResponse(messages, assistantId),
    prompt,
  };
}

export function prepareRegeneration(
  messages: ChatMessage[],
  assistantId: string,
): {messages: ChatMessage[]; prompt?: ChatMessage} {
  const prompt = findRetryUserMessage(messages, assistantId);
  const assistantIndex = messages.findIndex(
    message => message.id === assistantId,
  );
  if (assistantIndex < 0) {
    return {messages, prompt};
  }
  return {
    messages: messages.slice(0, assistantIndex).concat({
      id: assistantId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      status: 'streaming',
    }),
    prompt,
  };
}

export function editUserMessage(
  messages: ChatMessage[],
  messageId: string,
  content: string,
): {messages: ChatMessage[]; prompt?: ChatMessage} {
  const index = messages.findIndex(
    message => message.id === messageId && message.role === 'user',
  );
  if (index < 0 || !content.trim()) {
    return {messages};
  }
  const edited: ChatMessage = {
    ...messages[index],
    content: content.trim(),
    updatedAt: Date.now(),
    status: 'completed',
  };
  return {
    messages: messages.slice(0, index).concat(edited),
    prompt: edited,
  };
}

function toApiContent(message: ChatMessage): string | ApiContentPart[] {
  if (!message.contentParts?.length) {
    return message.content;
  }
  return message.contentParts.map(part =>
    part.type === 'text'
      ? {type: 'text' as const, text: part.text}
      : {type: 'image_url' as const, image_url: {url: part.image.uri}},
  );
}

function contentPartsForPrompt(
  prompt: string,
  parts?: MessageContentPart[],
): string | ApiContentPart[] {
  if (!parts?.length) {
    return prompt;
  }
  return [
    {type: 'text' as const, text: prompt},
    ...parts.map(part =>
      part.type === 'text'
        ? {type: 'text' as const, text: part.text}
        : {type: 'image_url' as const, image_url: {url: part.image.uri}},
    ),
  ];
}

export function buildRequestMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  userPrompt?: string,
  userParts?: MessageContentPart[],
): Array<{
  role: 'system' | 'user' | 'assistant';
  content: string | ApiContentPart[];
}> {
  return [
    ...(systemPrompt.trim()
      ? [{role: 'system' as const, content: systemPrompt.trim()}]
      : []),
    ...messages.map(message => ({
      role: message.role,
      content: toApiContent(message),
    })),
    ...(userPrompt && userPrompt !== messages.at(-1)?.content
      ? [
          {
            role: 'user' as const,
            content: contentPartsForPrompt(userPrompt, userParts),
          },
        ]
      : []),
  ];
}
