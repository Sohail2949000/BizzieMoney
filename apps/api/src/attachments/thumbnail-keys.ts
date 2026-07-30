const THUMBNAIL_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const THUMBNAIL_MIME_TYPE = 'image/webp';

export function supportsAttachmentThumbnail(mimeType: string): boolean {
  return THUMBNAIL_MIME_TYPES.has(mimeType);
}

export function thumbnailObjectKey(originalObjectKey: string): string {
  const separator = originalObjectKey.lastIndexOf('/');
  if (separator < 1) throw new Error('ATTACHMENT_OBJECT_KEY_INVALID');
  return `${originalObjectKey.slice(0, separator)}/thumbnail.webp`;
}

export function attachmentObjectKeys(
  originalObjectKey: string,
  mimeType: string,
): string[] {
  return supportsAttachmentThumbnail(mimeType)
    ? [originalObjectKey, thumbnailObjectKey(originalObjectKey)]
    : [originalObjectKey];
}
