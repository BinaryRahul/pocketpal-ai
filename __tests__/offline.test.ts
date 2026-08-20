const mockStorage = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStorage.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStorage.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStorage.delete(key);
  }),
}));

import {
  enqueueSend,
  loadDrafts,
  loadOfflineQueue,
  markQueueAttempt,
  saveDraft,
} from '../src/offline/queue';

describe('offline queue and drafts', () => {
  beforeEach(() => mockStorage.clear());

  it('queues prompts in order and prevents duplicate queued prompts', async () => {
    const first = await enqueueSend('c1', 'First prompt');
    const second = await enqueueSend('c1', 'Second prompt');
    expect((await loadOfflineQueue()).map(item => item.id)).toEqual([
      first.id,
      second.id,
    ]);
    await expect(enqueueSend('c1', 'First prompt')).rejects.toThrow(
      'already queued',
    );
  });

  it('marks attempts and stops retrying after three failures', async () => {
    const item = await enqueueSend('c1', 'Retry me');
    await markQueueAttempt(item.id, 'network');
    await markQueueAttempt(item.id, 'network');
    const failed = await markQueueAttempt(item.id, 'network');
    expect(failed).toMatchObject({
      attempts: 3,
      status: 'failed',
      lastError: 'network',
    });
  });

  it('persists drafts by conversation and rejects oversized drafts', async () => {
    await saveDraft('c1', 'draft text');
    expect(await loadDrafts()).toEqual({c1: 'draft text'});
    await expect(saveDraft('c1', 'x'.repeat(70_000))).rejects.toThrow(
      'size limit',
    );
  });
});
