import React from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

import {chooseImage, AttachmentSource} from '../media/attachments';
import {ImageAttachment} from '../types';

const colors = {
  border: '#313b4a',
  text: '#f5f7fa',
  muted: '#9aa7b7',
  accent: '#75a7ff',
  danger: '#ff9b9b',
};

type Props = {
  attachments: ImageAttachment[];
  disabled?: boolean;
  onAdd: (attachment: ImageAttachment) => void;
  onRemove: (id: string) => void;
  onError: (message: string) => void;
};

export function AttachmentPicker({
  attachments,
  disabled,
  onAdd,
  onRemove,
  onError,
}: Props) {
  const pick = async (source: AttachmentSource) => {
    try {
      const attachment = await chooseImage(source);
      if (attachment) onAdd(attachment);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Could not add image.');
    }
  };
  return (
    <View style={styles.container}>
      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => pick('camera')}
          style={styles.button}>
          <Text style={styles.buttonText}>Camera</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => pick('library')}
          style={styles.button}>
          <Text style={styles.buttonText}>Photo</Text>
        </Pressable>
      </View>
      {attachments.length ? (
        <View style={styles.previewRow}>
          {attachments.map(attachment => (
            <View key={attachment.id} style={styles.preview}>
              <Image
                accessibilityLabel="Pending image attachment"
                source={{uri: attachment.uri}}
                style={styles.image}
              />
              <Pressable
                accessibilityLabel="Remove image attachment"
                onPress={() => onRemove(attachment.id)}
                style={styles.remove}>
                <Text style={styles.removeText}>×</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {paddingHorizontal: 10, paddingTop: 8},
  buttons: {flexDirection: 'row', gap: 8},
  button: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  buttonText: {color: colors.text, fontSize: 11},
  previewRow: {flexDirection: 'row', gap: 8, marginTop: 8},
  preview: {position: 'relative'},
  image: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    height: 56,
    width: 56,
  },
  remove: {
    alignItems: 'center',
    backgroundColor: colors.danger,
    borderRadius: 9,
    height: 18,
    justifyContent: 'center',
    position: 'absolute',
    right: -5,
    top: -5,
    width: 18,
  },
  removeText: {color: '#08101e', fontSize: 15, lineHeight: 18},
});
