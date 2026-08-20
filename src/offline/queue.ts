import AsyncStorage from '@react-native-async-storage/async-storage';

export const OFFLINE_QUEUE_KEY = '@mobigpt/offline-queue/v1';
export const DRAFTS_KEY = '@mobigpt/drafts/v1';
export const MAX_QUEUE_ITEMS = 20;
export const MAX_DRAFT_BYTES = 64 * 1024;

export type QueuedSend = {
  id: string;
  conversationId: string;
  prompt: string;
  createdAt: number;
  attempts: number;
  status: 'queued' | 'failed';
  lastError?: string;
};

export type DraftStore = Record<string, string>;

function byteLength(value: string): number {
  return encodeURIComponent(value).replace(/%[A-F\d]{2}/g, 'x').length;
}

export async function loadOfflineQueue(): Promise<QueuedSend[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      item =>
        item &&
        typeof item.id === 'string' &&
        typeof item.conversationId === 'string' &&
        typeof item.prompt === 'string' &&
        (item.status === 'queued' || item.status === 'failed'),
    ) as QueuedSend[];
  } catch {
    return [];
  }
}

async function saveQueue(queue: QueuedSend[]): Promise<void> {
  await AsyncStorage.setItem(
    OFFLINE_QUEUE_KEY,
    JSON.stringify(queue.slice(0, MAX_QUEUE_ITEMS)),
  );
}

export async function enqueueSend(
  conversationId: string,
  prompt: string,
): Promise<QueuedSend> {
  if (!prompt.trim()) throw new Error('Cannot queue an empty prompt.');
  const queue = await loadOfflineQueue();
  if (
    queue.some(
      item =>
        item.conversationId === conversationId &&
        item.prompt === prompt &&
        item.status === 'queued',
    )
  ) {
    throw new Error('This prompt is already queued.');
  }
  if (queue.length >= MAX_QUEUE_ITEMS)
    throw new Error('Offline queue is full.');
  const item: QueuedSend = {
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    conversationId,
    prompt: prompt.trim(),
    createdAt: Date.now(),
    attempts: 0,
    status: 'queued',
  };
  await saveQueue([...queue, item]);
  return item;
}

export async function removeQueuedSend(id: string): Promise<void> {
  await saveQueue((await loadOfflineQueue()).filter(item => item.id !== id));
}

export async function markQueueAttempt(
  id: string,
  error?: string,
): Promise<QueuedSend | null> {
  const queue = await loadOfflineQueue();
  let updated: QueuedSend | null = null;
  const next = queue.map(item => {
    if (item.id !== id) return item;
    updated = {
      ...item,
      attempts: item.attempts + 1,
      status: item.attempts + 1 >= 3 ? 'failed' : 'queued',
      ...(error ? {lastError: error.slice(0, 1_000)} : {}),
    };
    return updated;
  });
  await saveQueue(next);
  return updated;
}

export async function loadDrafts(): Promise<DraftStore> {
  const raw = await AsyncStorage.getItem(DRAFTS_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
    ) as DraftStore;
  } catch {
    return {};
  }
}

export async function saveDraft(
  conversationId: string,
  draft: string,
): Promise<void> {
  if (byteLength(draft) > MAX_DRAFT_BYTES)
    throw new Error('Draft exceeds the supported size limit.');
  const drafts = await loadDrafts();
  if (draft) drafts[conversationId] = draft;
  else delete drafts[conversationId];
  await AsyncStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
}

export async function clearDraft(conversationId: string): Promise<void> {
  await saveDraft(conversationId, '');
}
