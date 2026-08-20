import {
  ApiSettings,
  DEFAULT_PROVIDER_CAPABILITIES,
  DEFAULT_SETTINGS,
  ModelInfo,
  ProviderCapabilities,
  ProviderId,
  ProviderProfile,
  ProviderValidationError,
} from '../types';

export type ProviderPreset = {
  providerId: ProviderId;
  name: string;
  baseUrl: string;
  model: string;
  capabilities: ProviderCapabilities;
  requiresApiKey: boolean;
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    providerId: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    capabilities: DEFAULT_PROVIDER_CAPABILITIES,
    requiresApiKey: true,
  },
  {
    providerId: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    capabilities: DEFAULT_PROVIDER_CAPABILITIES,
    requiresApiKey: true,
  },
  {
    providerId: 'ollama',
    name: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3.2',
    capabilities: {...DEFAULT_PROVIDER_CAPABILITIES, modelDiscovery: true},
    requiresApiKey: false,
  },
  {
    providerId: 'lmstudio',
    name: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    capabilities: DEFAULT_PROVIDER_CAPABILITIES,
    requiresApiKey: false,
  },
  {
    providerId: 'custom',
    name: 'Custom OpenAI-compatible',
    baseUrl: 'https://example.test/v1',
    model: '',
    capabilities: DEFAULT_PROVIDER_CAPABILITIES,
    requiresApiKey: false,
  },
];

export function getProviderPreset(providerId: ProviderId): ProviderPreset {
  return (
    PROVIDER_PRESETS.find(preset => preset.providerId === providerId) ??
    PROVIDER_PRESETS[4]
  );
}

export function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

export function isLocalEndpoint(baseUrl: string): boolean {
  return /^(https?:\/\/)?(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/i.test(
    baseUrl.trim(),
  );
}

export function requiresTrustWarning(
  baseUrl: string,
  providerId: ProviderId,
): boolean {
  return providerId === 'custom' && !isLocalEndpoint(baseUrl);
}

export function validateProviderInput(
  input: Partial<ProviderProfile>,
): ProviderValidationError[] {
  const errors: ProviderValidationError[] = [];
  if (!input.name?.trim()) {
    errors.push({field: 'name', message: 'Give this provider a name.'});
  }
  const baseUrl = input.baseUrl?.trim() ?? '';
  if (!baseUrl) {
    errors.push({field: 'baseUrl', message: 'Enter a provider URL.'});
  } else if (!/^https?:\/\//i.test(baseUrl)) {
    errors.push({
      field: 'baseUrl',
      message: 'URL must start with http:// or https://.',
    });
  }
  if (!input.model?.trim()) {
    errors.push({
      field: 'model',
      message: 'Enter a model name or discover models.',
    });
  }
  if (
    typeof input.temperature !== 'number' ||
    !Number.isFinite(input.temperature) ||
    input.temperature < 0 ||
    input.temperature > 2
  ) {
    errors.push({
      field: 'temperature',
      message: 'Temperature must be between 0 and 2.',
    });
  }
  if (
    typeof input.maxTokens !== 'number' ||
    !Number.isInteger(input.maxTokens) ||
    input.maxTokens < 1 ||
    input.maxTokens > 1_000_000
  ) {
    errors.push({
      field: 'maxTokens',
      message: 'Token limit must be a whole number between 1 and 1,000,000.',
    });
  }
  return errors;
}

export function createProviderProfile(
  id: string,
  providerId: ProviderId,
  now: number,
): ProviderProfile {
  const preset = getProviderPreset(providerId);
  return {
    id,
    name: preset.name,
    providerId,
    baseUrl: preset.baseUrl,
    model: preset.model,
    temperature: DEFAULT_SETTINGS.temperature,
    maxTokens: DEFAULT_SETTINGS.maxTokens,
    systemPrompt: DEFAULT_SETTINGS.systemPrompt,
    apiKeyStored: false,
    trustedEndpoint: !requiresTrustWarning(preset.baseUrl, providerId),
    capabilities: {...preset.capabilities},
    createdAt: now,
    updatedAt: now,
  };
}

export function providerToApiSettings(profile: ProviderProfile): ApiSettings {
  return {
    baseUrl: normalizeBaseUrl(profile.baseUrl),
    model: profile.model.trim(),
    temperature: profile.temperature,
    maxTokens: profile.maxTokens,
    systemPrompt: profile.systemPrompt,
  };
}

export function modelsFromResponse(payload: unknown): ModelInfo[] {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray((payload as {data?: unknown}).data)
  ) {
    return [];
  }
  return (payload as {data: unknown[]}).data.flatMap(item => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as {id?: unknown}).id !== 'string'
    ) {
      return [];
    }
    const ownedBy = (item as {owned_by?: unknown}).owned_by;
    return [
      {
        id: (item as {id: string}).id,
        ...(typeof ownedBy === 'string' ? {ownedBy} : {}),
      },
    ];
  });
}
