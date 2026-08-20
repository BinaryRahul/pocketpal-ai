import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {QueuedSend} from '../offline/queue';

const colors = {
  surface: '#1a2029',
  border: '#313b4a',
  text: '#f5f7fa',
  muted: '#9aa7b7',
  accent: '#75a7ff',
  danger: '#ff9b9b',
  warning: '#ffd48a',
};

type Props = {
  connected: boolean;
  queue: QueuedSend[];
  queueEnabled: boolean;
  onToggleQueue: (enabled: boolean) => void;
  onCancel: (id: string) => Promise<void>;
};

export function OfflinePanel({
  connected,
  queue,
  queueEnabled,
  onToggleQueue,
  onCancel,
}: Props) {
  const [busyId, setBusyId] = useState<string>();
  return (
    <View style={styles.panel}>
      <Text
        style={[styles.heading, connected ? styles.online : styles.offline]}>
        {connected ? 'Online' : 'Offline — browsing remains available'}
      </Text>
      <Text style={styles.text}>
        Remote API generation is not offline-capable. Queued sends are optional
        and will submit the prompt to the configured endpoint when connectivity
        returns.
      </Text>
      <Pressable
        onPress={() => onToggleQueue(!queueEnabled)}
        style={styles.toggle}>
        <Text style={styles.text}>
          {queueEnabled ? 'Disable queued sends' : 'Enable queued sends'}
        </Text>
      </Pressable>
      {queue.length ? (
        <View style={styles.queue}>
          {queue.map(item => (
            <View key={item.id} style={styles.item}>
              <View style={styles.itemCopy}>
                <Text numberOfLines={2} style={styles.prompt}>
                  {item.prompt}
                </Text>
                <Text style={styles.meta}>
                  {item.status} · attempts {item.attempts}
                </Text>
              </View>
              <Pressable
                disabled={busyId === item.id}
                onPress={() => {
                  setBusyId(item.id);
                  onCancel(item.id).finally(() => setBusyId(undefined));
                }}>
                <Text style={styles.cancel}>Cancel</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.text}>No queued prompts.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  heading: {fontSize: 14, fontWeight: '700', marginBottom: 6},
  online: {color: colors.accent},
  offline: {color: colors.warning},
  text: {color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: 8},
  toggle: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  queue: {gap: 6},
  item: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    padding: 8,
  },
  itemCopy: {flex: 1},
  prompt: {color: colors.text, fontSize: 11},
  meta: {color: colors.muted, fontSize: 10, marginTop: 3},
  cancel: {color: colors.danger, fontSize: 10, marginLeft: 8},
});
