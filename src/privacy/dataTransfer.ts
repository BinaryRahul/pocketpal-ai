import {Share} from 'react-native';
import {
  errorCodes,
  isErrorWithCode,
  keepLocalCopy,
  pick,
  types,
} from '@react-native-documents/picker';
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
  const [document] = await pick({
    type: [types.plainText, 'application/json'],
    mode: 'import',
  });
  if (document.size && document.size > MAX_IMPORT_BYTES) {
    throw new Error('Import exceeds the supported size limit.');
  }
  const copies = await keepLocalCopy({
    files: [
      {uri: document.uri, fileName: document.name ?? 'mobigpt-import.json'},
    ],
    destination: 'cachesDirectory',
  });
  if (copies[0].status !== 'success') {
    throw new Error(
      copies[0].copyError ?? 'Could not read the selected import file.',
    );
  }
  const serialized = await RNFS.readFile(copies[0].localUri, 'utf8');
  if (byteLength(serialized) > MAX_IMPORT_BYTES) {
    throw new Error('Import exceeds the supported size limit.');
  }
  const store = parseConversationImport(serialized);
  await saveConversationStore(store);
  return store;
}

export function isDocumentPickerCancelled(error: unknown): boolean {
  return isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED;
}
