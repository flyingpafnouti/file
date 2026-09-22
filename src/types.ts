export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'zip' | 'other';
export type QueueStatus = 'Waiting' | 'Processing' | 'Done' | 'Error' | 'Cancelled';

export interface FileMeta {
  id: string;
  file: File;
  kind: FileKind;
  extension: string;
  width?: number;
  height?: number;
  duration?: number;
  hash?: string;
  previewUrl?: string;
}

export interface ResultFile {
  id: string;
  sourceId: string;
  name: string;
  blob: Blob;
  width?: number;
  height?: number;
  previewUrl?: string;
}

export interface QueueItem {
  id: string;
  sourceId: string;
  name: string;
  operation: string;
  progress: number;
  status: QueueStatus;
  error?: string;
}

export interface Settings {
  operation: string;
  outputFormat: string;
  quality: number;
  maxWidth: number;
  maxHeight: number;
  keepRatio: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  resolution: string;
  videoQuality: 'high' | 'balanced' | 'small';
  bitrate: number;
  framerate: number;
  removeAudio: boolean;
  audioChannels: 'keep' | 'mono' | 'stereo';
  startTime: string;
  endTime: string;
  outputBaseName: string;
  prefix: string;
  suffix: string;
  numbering: boolean;
  search: string;
  replace: string;
}

export interface Preset {
  id: string;
  name: string;
  kind: FileKind | 'mixed';
  settings: Partial<Settings>;
  builtIn?: boolean;
}
