import {
  ApiMessage,
  ChatStream,
  ChatStreamResult,
  openAICompatibleProvider,
} from './provider';
import {ApiSettings} from '../types';

export type {ApiMessage, ChatStream, ChatStreamResult};

export function streamChatCompletion(
  settings: ApiSettings,
  apiKey: string,
  messages: ApiMessage[],
  onDelta: (text: string) => void,
): ChatStream {
  return openAICompatibleProvider.stream({settings, apiKey, messages}, onDelta);
}

export {openAICompatibleProvider};
