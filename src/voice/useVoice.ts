import {useCallback, useEffect, useState} from 'react';
import Voice, {SpeechResultsEvent} from '@react-native-voice/voice';
import Tts from 'react-native-tts';

export type VoiceState = {
  recording: boolean;
  speaking: boolean;
  transcript: string;
  available: boolean;
  error?: string;
};

export function useVoice(): VoiceState & {
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<string>;
  cancelRecording: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  stopSpeaking: () => Promise<void>;
  clearTranscript: () => void;
} {
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const handleResults = (event: SpeechResultsEvent) => {
      setTranscript(event.value?.[0] ?? '');
    };
    const handleError = (event: {error?: {message?: string}}) => {
      setError(event.error?.message ?? 'Speech recognition failed.');
      setRecording(false);
    };
    Voice.onSpeechResults = handleResults;
    Voice.onSpeechError = handleError;
    return () => {
      Voice.destroy().catch(() => undefined);
      Voice.removeAllListeners();
    };
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(undefined);
      setTranscript('');
      await Voice.start('en-US');
      setRecording(true);
    } catch (cause) {
      setAvailable(false);
      setError(
        cause instanceof Error
          ? cause.message
          : 'Speech recognition is unavailable.',
      );
    }
  }, []);

  const stopRecording = useCallback(async () => {
    try {
      await Voice.stop();
    } finally {
      setRecording(false);
    }
    return transcript;
  }, [transcript]);

  const cancelRecording = useCallback(async () => {
    try {
      await Voice.cancel();
    } finally {
      setRecording(false);
      setTranscript('');
    }
  }, []);

  const speak = useCallback(async (text: string) => {
    if (!text.trim()) return;
    try {
      await Tts.stop();
      Tts.speak(text);
      setSpeaking(true);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Text-to-speech is unavailable.',
      );
    }
  }, []);

  const stopSpeaking = useCallback(async () => {
    await Tts.stop();
    setSpeaking(false);
  }, []);

  const clearTranscript = useCallback(() => setTranscript(''), []);

  return {
    recording,
    speaking,
    transcript,
    available,
    error,
    startRecording,
    stopRecording,
    cancelRecording,
    speak,
    stopSpeaking,
    clearTranscript,
  };
}
