import JSZip from 'jszip';
import type { ResultFile } from '../types';

export async function createZip(files: Array<{ name: string; blob: Blob }>, onProgress?: (value: number) => void) {
  const zip = new JSZip();
  files.forEach(file => zip.file(file.name, file.blob));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, meta => onProgress?.(meta.percent));
}

export async function listZip(file: File) {
  const zip = await JSZip.loadAsync(file);
  return Object.values(zip.files).filter(entry => !entry.dir).map(entry => ({ name: entry.name, size: (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize || 0 }));
}

export async function extractZip(file: File): Promise<ResultFile[]> {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter(entry => !entry.dir);
  return Promise.all(entries.map(async entry => ({ id: crypto.randomUUID(), sourceId: '', name: entry.name, blob: await entry.async('blob') })));
}
