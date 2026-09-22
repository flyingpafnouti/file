import type { FileKind, FileMeta, Settings } from '../types';

export const formatBytes = (bytes: number) => {
  if (!bytes) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toLocaleString('fr-FR', { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
};

export const formatDuration = (seconds?: number) => {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export const extensionOf = (name: string) => name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');

export function detectKind(file: File): FileKind {
  const ext = extensionOf(file.name);
  if (file.type.startsWith('image/') || ['jpg','jpeg','png','webp','gif','bmp','avif'].includes(ext)) return 'image';
  if (file.type.startsWith('video/') || ['mov','mp4','webm','mkv','avi','m4v'].includes(ext)) return 'video';
  if (file.type.startsWith('audio/') || ['wav','mp3','aac','m4a','ogg','opus','flac'].includes(ext)) return 'audio';
  if (file.type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (file.type.includes('zip') || ext === 'zip') return 'zip';
  return 'other';
}

function mediaMetadata(file: File, kind: 'audio' | 'video') {
  return new Promise<Partial<FileMeta>>((resolve) => {
    const node = document.createElement(kind);
    const url = URL.createObjectURL(file);
    node.preload = 'metadata';
    node.onloadedmetadata = () => {
      const meta = { duration: node.duration, width: kind === 'video' ? (node as HTMLVideoElement).videoWidth : undefined, height: kind === 'video' ? (node as HTMLVideoElement).videoHeight : undefined };
      URL.revokeObjectURL(url);
      resolve(meta);
    };
    node.onerror = () => { URL.revokeObjectURL(url); resolve({}); };
    node.src = url;
  });
}

function imageMetadata(file: File) {
  return new Promise<Partial<FileMeta>>((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { const meta = { width: img.naturalWidth, height: img.naturalHeight, previewUrl: url }; resolve(meta); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve({}); };
    img.src = url;
  });
}

export async function inspectFile(file: File): Promise<FileMeta> {
  const kind = detectKind(file);
  const details = kind === 'image' ? await imageMetadata(file) : kind === 'video' || kind === 'audio' ? await mediaMetadata(file, kind) : {};
  return { id: crypto.randomUUID(), file, kind, extension: extensionOf(file.name), ...details };
}

export function outputName(file: File, settings: Settings, index: number, extension: string) {
  let name = baseName(file.name);
  if (settings.search) name = name.split(settings.search).join(settings.replace);
  const number = settings.numbering ? `-${String(index + 1).padStart(3, '0')}` : '';
  return `${settings.prefix}${name}${settings.suffix}${number}.${extension}`;
}

export async function sha256(file: File) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
