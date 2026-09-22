import type { FileMeta, Settings } from '../types';
import { outputName } from '../core/files';

const mimeMap: Record<string, string> = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif' };

export async function supportsImageType(type: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return new Promise<boolean>(resolve => canvas.toBlob(blob => resolve(blob?.type === type), type));
}

export async function processImage(meta: FileMeta, settings: Settings, index: number) {
  const bitmap = await createImageBitmap(meta.file);
  const maxW = settings.maxWidth || bitmap.width;
  const maxH = settings.maxHeight || bitmap.height;
  const scale = settings.keepRatio ? Math.min(1, maxW / bitmap.width, maxH / bitmap.height) : 1;
  const targetW = settings.keepRatio ? Math.max(1, Math.round(bitmap.width * scale)) : maxW;
  const targetH = settings.keepRatio ? Math.max(1, Math.round(bitmap.height * scale)) : maxH;
  const swap = Math.abs(settings.rotation) % 180 === 90;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? targetH : targetW;
  canvas.height = swap ? targetW : targetH;
  const ctx = canvas.getContext('2d', { alpha: settings.outputFormat === 'png' });
  if (!ctx) throw new Error('Canvas indisponible dans ce navigateur.');
  if (settings.outputFormat === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate(settings.rotation * Math.PI / 180);
  ctx.scale(settings.flipH ? -1 : 1, settings.flipV ? -1 : 1);
  ctx.drawImage(bitmap, -targetW / 2, -targetH / 2, targetW, targetH);
  bitmap.close();
  let format = settings.outputFormat || 'webp';
  let mime = mimeMap[format] || 'image/webp';
  if (!(await supportsImageType(mime))) { format = 'webp'; mime = 'image/webp'; }
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Conversion d’image impossible.')), mime, settings.quality / 100));
  return { blob, name: outputName(meta.file, settings, index, format === 'jpeg' ? 'jpg' : format), width: canvas.width, height: canvas.height };
}
