import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

const colors = {
  border: '#313b4a',
  text: '#f5f7fa',
  accent: '#75a7ff',
  danger: '#ff9b9b',
  muted: '#9aa7b7',
};

type Props = {
  available: boolean;
  recording: boolean;
  speaking: boolean;
  transcript: string;
  onStart: () => Promise<void>;
  onStop: () => Promise<void>;
  onCancel: () => Promise<void>;
  onSpeak: () => Promise<void>;
  onStopSpeaking: () => Promise<void>;
  onUseTranscript: () => void;
};

export function VoiceControls({
  available,
  recording,
  speaking,
  transcript,
  onStart,
  onStop,
  onCancel,
  onSpeak,
  onStopSpeaking,
  onUseTranscript,
}: Props) {
  if (!available)
    return (
      <Text style={styles.unavailable}>
        Speech features are unavailable on this device.
      </Text>
    );
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={recording ? onStop : onStart}
          style={[styles.button, recording && styles.recording]}>
          <Text style={styles.text}>
            {recording ? 'Stop recording' : 'Push to talk'}
          </Text>
        </Pressable>
        {recording ? (
          <Pressable
            accessibilityRole="button"
            onPress={onCancel}
            style={styles.button}>
            <Text style={styles.danger}>Cancel</Text>
          </Pressable>
        ) : null}
        {speaking ? (
          <Pressable
            accessibilityRole="button"
            onPress={onStopSpeaking}
            style={styles.button}>
            <Text style={styles.text}>Stop speaking</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={!transcript}
            onPress={onSpeak}
            style={styles.button}>
            <Text style={styles.text}>Read response</Text>
          </Pressable>
        )}
      </View>
      {transcript ? (
        <View style={styles.transcript}>
          <Text style={styles.transcriptText}>{transcript}</Text>
          <Pressable onPress={onUseTranscript}>
            <Text style={styles.useText}>Use transcript</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {paddingHorizontal: 10, paddingTop: 6},
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 7},
  button: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  recording: {borderColor: colors.danger},
  text: {color: colors.text, fontSize: 11},
  danger: {color: colors.danger, fontSize: 11},
  unavailable: {
    color: colors.muted,
    fontSize: 11,
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  transcript: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    marginTop: 6,
    padding: 8,
  },
  transcriptText: {color: colors.text, fontSize: 12},
  useText: {color: colors.accent, fontSize: 11, marginTop: 5},
});
