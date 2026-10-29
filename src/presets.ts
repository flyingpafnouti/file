import type { Preset, Settings } from './types';

export const defaultSettings: Settings = {
  operation: 'convert', outputFormat: 'webp', quality: 82, maxWidth: 1920, maxHeight: 1920,
  keepRatio: true, rotation: 0, flipH: false, flipV: false, resolution: '1080p',
  videoQuality: 'balanced', bitrate: 0, framerate: 30, removeAudio: false,
  audioChannels: 'keep', startTime: '', endTime: '',
  segments: [{ start: '', end: '' }], cutMode: 'copy', outputBaseName: '', prefix: '', suffix: '', numbering: false,
  search: '', replace: '',
};

export const builtInPresets: Preset[] = [
  { id: 'web', name: 'Images Web', kind: 'image', builtIn: true, settings: { operation: 'convert', maxWidth: 1920, maxHeight: 1920, outputFormat: 'webp', quality: 82 } },
  { id: 'email', name: 'Email', kind: 'image', builtIn: true, settings: { operation: 'convert', maxWidth: 1280, maxHeight: 1280, outputFormat: 'jpeg', quality: 75 } },
  { id: 'thumb', name: 'Miniature', kind: 'image', builtIn: true, settings: { operation: 'convert', maxWidth: 400, maxHeight: 400, outputFormat: 'webp', quality: 75 } },
  { id: 'video-1080', name: 'Vidéo 1080p', kind: 'video', builtIn: true, settings: { operation: 'convert', outputFormat: 'mp4', resolution: '1080p', videoQuality: 'balanced' } },
];

export function getCustomPresets(): Preset[] {
  try { return JSON.parse(localStorage.getItem('filelab-presets') || '[]'); } catch { return []; }
}

export function saveCustomPreset(preset: Preset) {
  const presets = getCustomPresets().filter(item => item.id !== preset.id);
  localStorage.setItem('filelab-presets', JSON.stringify([...presets, preset]));
}
