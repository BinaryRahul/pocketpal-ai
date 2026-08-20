import {Share} from 'react-native';
import DocumentPicker from 'react-native-document-picker';
import RNFS from 'react-native-fs';

import {
  MAX_IMPORT_BYTES,
  loadConversationStore,
  parseConversationImport,
  saveConversationStore,
  serializeConversationExport,
} from '../storage';
import {ConversationStore} from '../types';

function byteLength(value: string): number {
  return encodeURIComponent(value).replace(/%[A-F\d]{2}/g, 'x').length;
}

export async function exportConversations(): Promise<void> {
  const store = await loadConversationStore();
  const serialized = serializeConversationExport(store);
  await Share.share({
    title: 'MobiGPT conversations',
    message: serialized,
  });
}

export async function importConversations(): Promise<ConversationStore | null> {
  const document = await DocumentPicker.pickSingle({
    type: [DocumentPicker.types.plainText, 'application/json'],
    copyTo: 'cachesDirectory',
  });
  if (document.size && document.size > MAX_IMPORT_BYTES) {
    throw new Error('Import exceeds the supported size limit.');
  }
  const path = document.fileCopyUri ?? document.uri;
  const serialized = await RNFS.readFile(path, 'utf8');
  if (byteLength(serialized) > MAX_IMPORT_BYTES) {
    throw new Error('Import exceeds the supported size limit.');
  }
  const store = parseConversationImport(serialized);
  await saveConversationStore(store);
  return store;
}

export function isDocumentPickerCancelled(error: unknown): boolean {
  return DocumentPicker.isCancel(error);
}
