import React, {useState} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {Conversation} from '../types';

const colors = {
  background: '#101318',
  surface: '#1a2029',
  surfaceRaised: '#232b37',
  border: '#313b4a',
  text: '#f5f7fa',
  muted: '#9aa7b7',
  accent: '#75a7ff',
  danger: '#ff9b9b',
};

type Props = {
  conversations: Conversation[];
  activeConversationId?: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
};

function formatUpdatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ConversationPanel({
  conversations,
  activeConversationId,
  query,
  onQueryChange,
  onSelect,
  onNew,
  onRename,
  onDuplicate,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const beginRename = (conversation: Conversation) => {
    setEditingId(conversation.id);
    setEditingTitle(conversation.title);
  };

  const finishRename = () => {
    if (editingId && editingTitle.trim()) {
      onRename(editingId, editingTitle.trim());
    }
    setEditingId(null);
    setEditingTitle('');
  };

  const confirmDelete = (conversation: Conversation) => {
    Alert.alert(
      'Delete conversation?',
      `Delete “${conversation.title}”? This cannot be undone on this device.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => onDelete(conversation.id),
        },
      ],
    );
  };

  return (
    <View style={styles.panel}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Conversations</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onNew}
          style={styles.newButton}>
          <Text style={styles.newButtonText}>New</Text>
        </Pressable>
      </View>
      <TextInput
        accessibilityLabel="Search conversations"
        autoCapitalize="none"
        onChangeText={onQueryChange}
        placeholder="Search conversations"
        placeholderTextColor={colors.muted}
        style={styles.search}
        value={query}
      />
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        {conversations.length === 0 ? (
          <Text style={styles.empty}>No conversations match your search.</Text>
        ) : (
          conversations.map(conversation => {
            const active = conversation.id === activeConversationId;
            const editing = editingId === conversation.id;
            return (
              <View
                key={conversation.id}
                style={[styles.item, active && styles.itemActive]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{selected: active}}
                  onPress={() => onSelect(conversation.id)}
                  style={styles.itemMain}>
                  {editing ? (
                    <TextInput
                      autoFocus
                      onBlur={finishRename}
                      onChangeText={setEditingTitle}
                      onSubmitEditing={finishRename}
                      style={styles.renameInput}
                      value={editingTitle}
                    />
                  ) : (
                    <Text numberOfLines={1} style={styles.title}>
                      {conversation.title}
                    </Text>
                  )}
                  <Text style={styles.timestamp}>
                    {formatUpdatedAt(conversation.updatedAt)}
                  </Text>
                </Pressable>
                <View style={styles.itemActions}>
                  <Pressable
                    accessibilityLabel={`Rename ${conversation.title}`}
                    onPress={() => beginRename(conversation)}>
                    <Text style={styles.action}>Rename</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Duplicate ${conversation.title}`}
                    onPress={() => onDuplicate(conversation.id)}>
                    <Text style={styles.action}>Copy</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Delete ${conversation.title}`}
                    onPress={() => confirmDelete(conversation)}>
                    <Text style={[styles.action, styles.delete]}>Delete</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    maxHeight: 260,
    padding: 12,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  heading: {color: colors.text, fontSize: 15, fontWeight: '700'},
  newButton: {
    backgroundColor: colors.accent,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  newButtonText: {color: '#08101e', fontSize: 12, fontWeight: '700'},
  search: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  list: {maxHeight: 180},
  empty: {color: colors.muted, fontSize: 12, paddingVertical: 8},
  item: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: 6,
    padding: 8,
  },
  itemActive: {borderColor: colors.accent},
  itemMain: {flex: 1, minWidth: 0},
  title: {color: colors.text, fontSize: 13, fontWeight: '600'},
  renameInput: {
    borderBottomColor: colors.accent,
    borderBottomWidth: 1,
    color: colors.text,
    fontSize: 13,
    paddingVertical: 0,
  },
  timestamp: {color: colors.muted, fontSize: 10, marginTop: 3},
  itemActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginLeft: 8,
  },
  action: {color: colors.accent, fontSize: 10},
  delete: {color: colors.danger},
});
