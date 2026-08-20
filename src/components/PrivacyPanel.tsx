import React, {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

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
  biometricSupported: boolean;
  biometricType?: string;
  biometricEnabled: boolean;
  onEnableBiometric: () => Promise<void>;
  onDisableBiometric: () => Promise<void>;
  onExport: () => Promise<void>;
  onImport: () => Promise<void>;
  onClearAll: () => Promise<void>;
};

export function PrivacyPanel({
  biometricSupported,
  biometricType,
  biometricEnabled,
  onEnableBiometric,
  onDisableBiometric,
  onExport,
  onImport,
  onClearAll,
}: Props) {
  const [status, setStatus] = useState('');
  const run = async (action: () => Promise<void>, success: string) => {
    try {
      await action();
      setStatus(success);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Privacy action failed.',
      );
    }
  };
  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>Privacy and local data</Text>
      <Text style={styles.text}>
        No telemetry is enabled by default. Conversation content is sent only
        when you submit it to the selected provider endpoint. API keys are
        stored in Keychain and are never included in conversation exports.
      </Text>
      <Text style={styles.warning}>
        For production use, prefer a trusted proxy. A custom endpoint can read
        the full conversation, system prompt, and any attachments you send.
      </Text>
      <View style={styles.row}>
        <Pressable
          onPress={() => run(onExport, 'Export prepared without API keys.')}
          style={styles.button}>
          <Text style={styles.buttonText}>Export conversations</Text>
        </Pressable>
        <Pressable
          onPress={() => run(onImport, 'Import completed.')}
          style={styles.button}>
          <Text style={styles.buttonText}>Import conversations</Text>
        </Pressable>
      </View>
      {biometricSupported ? (
        <Pressable
          onPress={() =>
            run(
              biometricEnabled ? onDisableBiometric : onEnableBiometric,
              biometricEnabled
                ? 'Biometric app lock disabled.'
                : 'Biometric app lock enabled.',
            )
          }
          style={styles.button}>
          <Text style={styles.buttonText}>
            {biometricEnabled
              ? `Disable ${biometricType ?? 'biometric'} app lock`
              : `Enable ${biometricType ?? 'biometric'} app lock`}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.text}>
          Biometric app lock is not available. The app will not claim protection
          that the device cannot provide.
        </Text>
      )}
      <Pressable
        onPress={() =>
          run(onClearAll, 'All local data and stored keys were cleared.')
        }
        style={styles.dangerButton}>
        <Text style={styles.dangerText}>Clear all local data</Text>
      </Pressable>
      {status ? (
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {status}
        </Text>
      ) : null}
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
  heading: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 6,
  },
  text: {color: colors.muted, fontSize: 11, lineHeight: 16, marginBottom: 8},
  warning: {
    color: colors.warning,
    fontSize: 11,
    lineHeight: 16,
    marginBottom: 8,
  },
  row: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  button: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  buttonText: {color: colors.text, fontSize: 11},
  dangerButton: {marginTop: 2, paddingVertical: 8},
  dangerText: {color: colors.danger, fontSize: 11, fontWeight: '700'},
  status: {color: colors.accent, fontSize: 11, marginTop: 4},
});
