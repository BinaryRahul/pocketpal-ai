import {useCallback, useEffect, useState} from 'react';
import NetInfo, {NetInfoState} from '@react-native-community/netinfo';

import {
  enqueueSend,
  loadOfflineQueue,
  markQueueAttempt,
  removeQueuedSend,
  QueuedSend,
} from './queue';

export function useOfflineQueue() {
  const [connected, setConnected] = useState(true);
  const [queue, setQueue] = useState<QueuedSend[]>([]);

  useEffect(() => {
    let mounted = true;
    loadOfflineQueue().then(items => mounted && setQueue(items));
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      if (mounted)
        setConnected(
          state.isConnected !== false && state.isInternetReachable !== false,
        );
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  const queueSend = useCallback(
    async (conversationId: string, prompt: string) => {
      const item = await enqueueSend(conversationId, prompt);
      setQueue(previous => [...previous, item]);
      return item;
    },
    [],
  );

  const cancelQueuedSend = useCallback(async (id: string) => {
    await removeQueuedSend(id);
    setQueue(previous => previous.filter(item => item.id !== id));
  }, []);

  const flush = useCallback(
    async (send: (item: QueuedSend) => Promise<void>) => {
      if (!connected) return;
      const current = await loadOfflineQueue();
      for (const item of current.filter(entry => entry.status === 'queued')) {
        try {
          await send(item);
          await removeQueuedSend(item.id);
          setQueue(previous => previous.filter(entry => entry.id !== item.id));
        } catch (error) {
          const updated = await markQueueAttempt(
            item.id,
            error instanceof Error ? error.message : 'Queued send failed.',
          );
          if (updated)
            setQueue(previous =>
              previous.map(entry =>
                entry.id === updated?.id ? updated : entry,
              ),
            );
        }
      }
    },
    [connected],
  );

  return {connected, queue, queueSend, cancelQueuedSend, flush};
}
