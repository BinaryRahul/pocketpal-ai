import React, {useEffect, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {ProviderId, ProviderProfile} from '../types';
import {
  PROVIDER_PRESETS,
  requiresTrustWarning,
} from '../providers/providerProfiles';

const colors = {
  surface: '#1a2029',
  surfaceRaised: '#232b37',
  border: '#313b4a',
  text: '#f5f7fa',
  muted: '#9aa7b7',
  accent: '#75a7ff',
  danger: '#ff9b9b',
  warning: '#ffd48a',
};

type Props = {
  profiles: ProviderProfile[];
  activeProfile?: ProviderProfile;
  activeApiKey: string;
  firstRun: boolean;
  onCreate: (providerId: ProviderId) => Promise<ProviderProfile>;
  onSelect: (id: string) => Promise<ProviderProfile | null>;
  onSave: (profile: ProviderProfile, apiKey: string) => Promise<void>;
  onDeleteKey: (id: string) => Promise<void>;
  onTest: (profile: ProviderProfile, apiKey: string) => Promise<string>;
  onDiscover: (profile: ProviderProfile, apiKey: string) => Promise<string[]>;
};

export function ProviderPanel({
  profiles,
  activeProfile,
  activeApiKey,
  firstRun,
  onCreate,
  onSelect,
  onSave,
  onDeleteKey,
  onTest,
  onDiscover,
}: Props) {
  const [draft, setDraft] = useState<ProviderProfile | undefined>(
    activeProfile,
  );
  const [apiKey, setApiKey] = useState(activeApiKey);
  const [showApiKey, setShowApiKey] = useState(false);
  const [status, setStatus] = useState('');
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    setDraft(activeProfile);
    setApiKey(activeApiKey);
    setModels([]);
  }, [activeApiKey, activeProfile]);

  const update = <K extends keyof ProviderProfile>(
    key: K,
    value: ProviderProfile[K],
  ) => {
    setDraft(previous => (previous ? {...previous, [key]: value} : previous));
  };

  const selectPreset = async (providerId: ProviderId) => {
    const profile = await onCreate(providerId);
    setDraft(profile);
    setApiKey('');
    setStatus(`${profile.name} setup started.`);
  };

  const save = async () => {
    if (!draft) {
      return;
    }
    try {
      await onSave(
        {...draft, apiKeyStored: Boolean(apiKey.trim()) || draft.apiKeyStored},
        apiKey,
      );
      setStatus('Provider profile saved.');
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Could not save provider.',
      );
    }
  };

  const test = async () => {
    if (!draft) {
      return;
    }
    try {
      setStatus('Testing connection…');
      setStatus(await onTest(draft, apiKey));
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Connection test failed.',
      );
    }
  };

  const discover = async () => {
    if (!draft) {
      return;
    }
    try {
      setStatus('Discovering models…');
      const discovered = await onDiscover(draft, apiKey);
      setModels(discovered);
      setStatus(
        discovered.length
          ? `Found ${discovered.length} models.`
          : 'This endpoint did not return models.',
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : 'Model discovery failed.',
      );
    }
  };

  return (
    <View style={styles.panel}>
      <Text style={styles.heading}>
        {firstRun ? 'Set up your provider' : 'Provider profile'}
      </Text>
      <Text style={styles.explanation}>
        Prefer a trusted proxy for production use. A mobile client cannot make a
        provider key fully secret, and a custom endpoint can receive the entire
        conversation.
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.providerPicker}>
        {PROVIDER_PRESETS.map(preset => {
          const selected = draft?.providerId === preset.providerId;
          return (
            <Pressable
              key={preset.providerId}
              onPress={() => selectPreset(preset.providerId)}
              style={[
                styles.providerChip,
                selected && styles.providerChipSelected,
              ]}>
              <Text
                style={[
                  styles.providerChipText,
                  selected && styles.providerChipTextSelected,
                ]}>
                {preset.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {profiles.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.profilePicker}>
          {profiles.map(profile => (
            <Pressable
              key={profile.id}
              onPress={() => onSelect(profile.id)}
              style={[
                styles.profileChip,
                profile.id === draft?.id && styles.profileChipSelected,
              ]}>
              <Text style={styles.profileChipText}>{profile.name}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {draft ? (
        <>
          <TextInput
            onChangeText={value => update('name', value)}
            placeholder="Profile name"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.name}
          />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            onChangeText={value => update('baseUrl', value)}
            placeholder="https://api.openai.com/v1"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.baseUrl}
          />
          <View style={styles.keyRow}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setApiKey}
              placeholder={
                draft.apiKeyStored
                  ? 'API key stored — enter to replace'
                  : 'API key (stored in Keychain)'
              }
              placeholderTextColor={colors.muted}
              secureTextEntry={!showApiKey}
              style={[styles.input, styles.keyInput]}
              value={apiKey}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowApiKey(value => !value)}
              style={styles.visibilityButton}>
              <Text style={styles.secondaryText}>
                {showApiKey ? 'Hide' : 'Show'}
              </Text>
            </Pressable>
          </View>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={value => update('model', value)}
            placeholder="Model name"
            placeholderTextColor={colors.muted}
            style={styles.input}
            value={draft.model}
          />
          <View style={styles.row}>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={value => update('temperature', Number(value) || 0)}
              placeholder="Temperature"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.half]}
              value={String(draft.temperature)}
            />
            <TextInput
              keyboardType="number-pad"
              onChangeText={value => update('maxTokens', Number(value) || 1)}
              placeholder="Max tokens"
              placeholderTextColor={colors.muted}
              style={[styles.input, styles.half]}
              value={String(draft.maxTokens)}
            />
          </View>
          <TextInput
            multiline
            onChangeText={value => update('systemPrompt', value)}
            placeholder="System prompt"
            placeholderTextColor={colors.muted}
            style={[styles.input, styles.prompt]}
            value={draft.systemPrompt}
          />
          {requiresTrustWarning(draft.baseUrl, draft.providerId) &&
          !draft.trustedEndpoint ? (
            <Text style={styles.warning}>
              Trust warning: this custom endpoint may inspect prompts,
              responses, and attachments. Save only after verifying who operates
              it.
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            <Pressable onPress={save} style={styles.primaryButton}>
              <Text style={styles.primaryText}>Save</Text>
            </Pressable>
            <Pressable onPress={test} style={styles.secondaryButton}>
              <Text style={styles.secondaryText}>Test connection</Text>
            </Pressable>
            {draft.capabilities.modelDiscovery ? (
              <Pressable onPress={discover} style={styles.secondaryButton}>
                <Text style={styles.secondaryText}>Discover models</Text>
              </Pressable>
            ) : null}
          </View>
          {draft.apiKeyStored ? (
            <Pressable
              onPress={() => onDeleteKey(draft.id).then(() => setApiKey(''))}
              style={styles.deleteButton}>
              <Text style={styles.deleteText}>Delete stored API key</Text>
            </Pressable>
          ) : null}
          {models.length ? (
            <View style={styles.modelList}>
              {models.slice(0, 20).map(model => (
                <Pressable key={model} onPress={() => update('model', model)}>
                  <Text style={styles.model}>{model}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      ) : (
        <Text style={styles.empty}>
          Choose a provider above to begin. You may use a local Ollama or LM
          Studio endpoint without an API key.
        </Text>
      )}
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
  explanation: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 10,
  },
  providerPicker: {marginBottom: 8},
  providerChip: {
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  providerChipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  providerChipText: {color: colors.text, fontSize: 11},
  providerChipTextSelected: {color: '#08101e', fontWeight: '700'},
  profilePicker: {marginBottom: 8},
  profileChip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    marginRight: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  profileChipSelected: {borderColor: colors.accent, borderWidth: 1},
  profileChipText: {color: colors.text, fontSize: 10},
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  row: {flexDirection: 'row', gap: 8},
  keyRow: {alignItems: 'center', flexDirection: 'row', gap: 8},
  keyInput: {marginBottom: 8},
  visibilityButton: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
  },
  half: {flex: 1},
  prompt: {minHeight: 54, textAlignVertical: 'top'},
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  primaryText: {color: '#08101e', fontSize: 12, fontWeight: '700'},
  secondaryButton: {
    borderColor: colors.border,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  secondaryText: {color: colors.text, fontSize: 11},
  deleteButton: {marginTop: 8},
  deleteText: {color: colors.danger, fontSize: 11},
  warning: {
    color: colors.warning,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 8,
  },
  modelList: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    marginTop: 8,
    padding: 8,
  },
  model: {color: colors.accent, fontSize: 11, paddingVertical: 4},
  empty: {color: colors.muted, fontSize: 12, lineHeight: 17},
  status: {color: colors.muted, fontSize: 11, marginTop: 8},
});
