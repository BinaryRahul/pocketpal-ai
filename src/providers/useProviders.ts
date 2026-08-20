import {useCallback, useEffect, useMemo, useState} from 'react';

import {
  deleteProviderApiKey,
  loadProviderApiKey,
  loadProviderProfiles,
  saveProviderApiKey,
  saveProviderProfiles,
} from '../storage';
import {ModelInfo, ProviderProfile} from '../types';
import {
  createProviderProfile,
  modelsFromResponse,
  normalizeBaseUrl,
  requiresTrustWarning,
  validateProviderInput,
} from './providerProfiles';

export type UseProvidersResult = {
  ready: boolean;
  profiles: ProviderProfile[];
  activeProfile?: ProviderProfile;
  activeProfileId?: string;
  apiKey: string;
  firstRun: boolean;
  selectProvider: (id: string) => Promise<ProviderProfile | null>;
  createProvider: (
    providerId: ProviderProfile['providerId'],
  ) => Promise<ProviderProfile>;
  updateProvider: (
    profile: ProviderProfile,
    apiKey?: string,
  ) => Promise<ProviderProfile>;
  deleteProvider: (id: string) => Promise<void>;
  removeApiKey: (id: string) => Promise<void>;
  testConnection: (
    profile: ProviderProfile,
    apiKey?: string,
  ) => Promise<string>;
  discoverModels: (
    profile: ProviderProfile,
    apiKey?: string,
  ) => Promise<ModelInfo[]>;
};

function withNormalizedProfile(profile: ProviderProfile): ProviderProfile {
  return {
    ...profile,
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    trustedEndpoint:
      profile.trustedEndpoint ||
      !requiresTrustWarning(profile.baseUrl, profile.providerId),
    updatedAt: Date.now(),
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timeout);
  }
}

export function useProviders(): UseProvidersResult {
  const [profiles, setProfiles] = useState<ProviderProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string>();
  const [apiKey, setApiKey] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    loadProviderProfiles()
      .then(async loaded => {
        if (!mounted) {
          return;
        }
        setProfiles(loaded);
        const active = loaded[0];
        if (active) {
          setActiveProfileId(active.id);
          setApiKey(await loadProviderApiKey(active.id));
        }
        setReady(true);
      })
      .catch(() => {
        if (mounted) {
          setReady(true);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const activeProfile = useMemo(
    () => profiles.find(profile => profile.id === activeProfileId),
    [activeProfileId, profiles],
  );

  const selectProvider = useCallback(
    async (id: string) => {
      const profile = profiles.find(item => item.id === id);
      if (!profile) {
        return null;
      }
      setActiveProfileId(id);
      setApiKey(await loadProviderApiKey(id));
      return profile;
    },
    [profiles],
  );

  const createProvider = useCallback(
    async (providerId: ProviderProfile['providerId']) => {
      const profile = createProviderProfile(
        `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        providerId,
        Date.now(),
      );
      const next = [...profiles, profile];
      await saveProviderProfiles(next);
      setProfiles(next);
      setActiveProfileId(profile.id);
      setApiKey('');
      return profile;
    },
    [profiles],
  );

  const updateProvider = useCallback(
    async (profile: ProviderProfile, nextApiKey?: string) => {
      const normalized = withNormalizedProfile(profile);
      const errors = validateProviderInput(normalized);
      if (errors.length) {
        throw new Error(errors[0].message);
      }
      const next = profiles.some(item => item.id === normalized.id)
        ? profiles.map(item => (item.id === normalized.id ? normalized : item))
        : [...profiles, normalized];
      await saveProviderProfiles(next);
      if (nextApiKey !== undefined) {
        await saveProviderApiKey(normalized.id, nextApiKey);
        setApiKey(nextApiKey.trim());
      }
      setProfiles(next);
      setActiveProfileId(normalized.id);
      return normalized;
    },
    [profiles],
  );

  const deleteProvider = useCallback(
    async (id: string) => {
      const next = profiles.filter(profile => profile.id !== id);
      await deleteProviderApiKey(id);
      await saveProviderProfiles(next);
      setProfiles(next);
      const replacement = next[0];
      setActiveProfileId(replacement?.id);
      setApiKey(replacement ? await loadProviderApiKey(replacement.id) : '');
    },
    [profiles],
  );

  const removeApiKey = useCallback(
    async (id: string) => {
      await deleteProviderApiKey(id);
      if (id === activeProfileId) {
        setApiKey('');
      }
      setProfiles(previous =>
        previous.map(profile =>
          profile.id === id
            ? {...profile, apiKeyStored: false, updatedAt: Date.now()}
            : profile,
        ),
      );
    },
    [activeProfileId],
  );

  const discoverModels = useCallback(
    async (profile: ProviderProfile, key = apiKey) => {
      const response = await fetchWithTimeout(
        `${normalizeBaseUrl(profile.baseUrl)}/models`,
        {
          headers: key.trim()
            ? {Authorization: `Bearer ${key.trim()}`}
            : undefined,
        },
      );
      if (!response.ok) {
        if (response.status === 404 || response.status === 405) {
          return [];
        }
        throw new Error(`Model discovery failed with HTTP ${response.status}.`);
      }
      return modelsFromResponse(await response.json());
    },
    [apiKey],
  );

  const testConnection = useCallback(
    async (profile: ProviderProfile, key = apiKey) => {
      await discoverModels(profile, key);
      return 'Connection succeeded.';
    },
    [apiKey, discoverModels],
  );

  return {
    ready,
    profiles,
    activeProfile,
    activeProfileId,
    apiKey,
    firstRun: ready && profiles.length === 0,
    selectProvider,
    createProvider,
    updateProvider,
    deleteProvider,
    removeApiKey,
    testConnection,
    discoverModels,
  };
}
