jest.mock('react-native-image-picker', () => ({
  launchCamera: jest.fn(),
  launchImageLibrary: jest.fn(),
}));
jest.mock('react-native-image-resizer', () => ({
  default: {createResizedImage: jest.fn()},
}));
jest.mock('react-native-fs', () => ({stat: jest.fn()}));

import {
  attachmentToApiPart,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
} from '../src/media/attachments';
import {ImageAttachment} from '../src/types';

describe('image attachments', () => {
  it('maps persisted images to OpenAI-compatible image URL parts', () => {
    const image: ImageAttachment = {
      id: 'image-1',
      uri: 'file:///tmp/image.jpg',
      mimeType: 'image/jpeg',
      width: 100,
      height: 80,
      sizeBytes: 1024,
    };
    expect(attachmentToApiPart(image)).toEqual({
      type: 'image_url',
      image_url: {url: image.uri},
    });
  });

  it('keeps explicit attachment limits bounded', () => {
    expect(MAX_IMAGE_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_IMAGE_DIMENSION).toBe(4096);
  });
});
