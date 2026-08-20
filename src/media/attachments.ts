import {
  launchCamera,
  launchImageLibrary,
  ImagePickerResponse,
  Asset,
} from 'react-native-image-picker';
import ImageResizer from 'react-native-image-resizer';
import RNFS from 'react-native-fs';

import {ImageAttachment} from '../types';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 4096;

export type AttachmentSource = 'camera' | 'library';

function pickAsset(response: ImagePickerResponse): Asset | null {
  if (response.didCancel || response.errorCode || !response.assets?.[0]) {
    return null;
  }
  return response.assets[0];
}

export async function chooseImage(
  source: AttachmentSource,
): Promise<ImageAttachment | null> {
  const response =
    source === 'camera'
      ? await launchCamera({
          mediaType: 'photo',
          quality: 0.9,
          saveToPhotos: false,
        })
      : await launchImageLibrary({
          mediaType: 'photo',
          selectionLimit: 1,
          quality: 0.9,
        });
  const asset = pickAsset(response);
  if (!asset?.uri) {
    return null;
  }
  if (asset.type && !asset.type.startsWith('image/')) {
    throw new Error('Only image attachments are supported.');
  }
  const width = asset.width ?? 0;
  const height = asset.height ?? 0;
  const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(width, height, 1));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const resized = await ImageResizer.createResizedImage(
    asset.uri,
    targetWidth,
    targetHeight,
    'JPEG',
    82,
    0,
    undefined,
    false,
    {mode: 'contain', onlyScaleDown: true},
  );
  const stat = await RNFS.stat(resized.uri);
  if (Number(stat.size) > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the 8 MB attachment limit.');
  }
  return {
    id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    uri: resized.uri,
    mimeType: 'image/jpeg',
    width: resized.width,
    height: resized.height,
    sizeBytes: Number(stat.size),
  };
}

export function attachmentToApiPart(attachment: ImageAttachment): {
  type: 'image_url';
  image_url: {url: string};
} {
  return {type: 'image_url', image_url: {url: attachment.uri}};
}
