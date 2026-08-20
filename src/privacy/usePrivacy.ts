import {useCallback, useEffect, useState} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import * as Keychain from 'react-native-keychain';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const APP_LOCK_PREFERENCE_KEY = '@mobigpt/privacy/app-lock/v1';
export const APP_LOCK_SERVICE = 'com.pocketpallite.mobigpt.app-lock';

export type BiometricState = {
  supported: boolean;
  enabled: boolean;
  locked: boolean;
  type?: string;
};

async function getBiometricType(): Promise<string | null> {
  const keychain = Keychain as typeof Keychain & {
    getSupportedBiometryType?: () => Promise<string | null>;
  };
  return keychain.getSupportedBiometryType
    ? keychain.getSupportedBiometryType()
    : null;
}

export function usePrivacyLock(): BiometricState & {
  ready: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  unlock: () => Promise<boolean>;
} {
  const [ready, setReady] = useState(false);
  const [supported, setSupported] = useState(false);
  const [type, setType] = useState<string>();
  const [enabled, setEnabled] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      getBiometricType(),
      AsyncStorage.getItem(APP_LOCK_PREFERENCE_KEY),
    ])
      .then(([biometry, preference]) => {
        if (!mounted) return;
        setSupported(Boolean(biometry));
        setType(biometry ?? undefined);
        const isEnabled = preference === 'enabled';
        setEnabled(isEnabled);
        setLocked(isEnabled);
        setReady(true);
      })
      .catch(() => mounted && setReady(true));
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const listener = (state: AppStateStatus) => {
      if (enabled && (state === 'background' || state === 'inactive')) {
        setLocked(true);
      }
    };
    const subscription = AppState.addEventListener('change', listener);
    return () => subscription.remove();
  }, [enabled]);

  const enable = useCallback(async () => {
    const biometry = await getBiometricType();
    if (!biometry) {
      throw new Error(
        'Biometric authentication is not available on this device.',
      );
    }
    const keychain = Keychain as typeof Keychain & {
      ACCESS_CONTROL?: {BIOMETRY_ANY_OR_DEVICE_PASSCODE?: string};
    };
    await Keychain.setGenericPassword('app-lock', 'enabled', {
      service: APP_LOCK_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      ...(keychain.ACCESS_CONTROL?.BIOMETRY_ANY_OR_DEVICE_PASSCODE
        ? {
            accessControl:
              keychain.ACCESS_CONTROL.BIOMETRY_ANY_OR_DEVICE_PASSCODE,
          }
        : {}),
    });
    await AsyncStorage.setItem(APP_LOCK_PREFERENCE_KEY, 'enabled');
    setSupported(true);
    setType(biometry);
    setEnabled(true);
    setLocked(true);
  }, []);

  const disable = useCallback(async () => {
    await Keychain.resetGenericPassword({service: APP_LOCK_SERVICE});
    await AsyncStorage.removeItem(APP_LOCK_PREFERENCE_KEY);
    setEnabled(false);
    setLocked(false);
  }, []);

  const unlock = useCallback(async () => {
    if (!enabled) {
      setLocked(false);
      return true;
    }
    try {
      const credentials = await Keychain.getGenericPassword({
        service: APP_LOCK_SERVICE,
        authenticationPrompt: {title: 'Unlock MobiGPT'},
      });
      const success = Boolean(credentials);
      if (success) setLocked(false);
      return success;
    } catch {
      return false;
    }
  }, [enabled]);

  return {ready, supported, type, enabled, locked, enable, disable, unlock};
}
