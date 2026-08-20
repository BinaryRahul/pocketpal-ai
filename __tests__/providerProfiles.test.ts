import {
  createProviderProfile,
  isLocalEndpoint,
  modelsFromResponse,
  normalizeBaseUrl,
  providerToApiSettings,
  requiresTrustWarning,
  validateProviderInput,
} from '../src/providers/providerProfiles';

describe('provider profiles', () => {
  it('creates usable presets and converts profiles to API settings', () => {
    const profile = createProviderProfile('p1', 'openai', 1);
    expect(profile.baseUrl).toBe('https://api.openai.com/v1');
    expect(profile.apiKeyStored).toBe(false);
    expect(providerToApiSettings(profile)).toMatchObject({
      baseUrl: profile.baseUrl,
      model: profile.model,
    });
  });

  it('normalizes URLs and distinguishes local endpoints from untrusted custom endpoints', () => {
    expect(normalizeBaseUrl('https://example.test/v1///')).toBe(
      'https://example.test/v1',
    );
    expect(isLocalEndpoint('http://localhost:1234/v1')).toBe(true);
    expect(isLocalEndpoint('http://192.168.1.20:1234/v1')).toBe(true);
    expect(requiresTrustWarning('https://example.test/v1', 'custom')).toBe(
      true,
    );
    expect(requiresTrustWarning('http://localhost:1234/v1', 'custom')).toBe(
      false,
    );
  });

  it('reports clear validation errors at the input boundaries', () => {
    const errors = validateProviderInput({
      name: '',
      baseUrl: 'ftp://example.test',
      model: '',
      temperature: 3,
      maxTokens: 0,
    });
    expect(errors.map(error => error.field)).toEqual([
      'name',
      'baseUrl',
      'model',
      'temperature',
      'maxTokens',
    ]);
    expect(
      validateProviderInput({
        name: 'Valid',
        baseUrl: 'https://example.test/v1',
        model: 'model',
        temperature: 1,
        maxTokens: 128,
      }),
    ).toEqual([]);
  });

  it('parses only model records with string IDs', () => {
    expect(
      modelsFromResponse({
        data: [{id: 'one', owned_by: 'owner'}, {id: 2}, null],
      }),
    ).toEqual([{id: 'one', ownedBy: 'owner'}]);
    expect(modelsFromResponse({data: 'invalid'})).toEqual([]);
  });
});
