import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { FileMeta, Settings } from '../types';
import { outputName } from '../core/files';

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let recentLogs: string[] = [];

async function getFFmpeg(onProgress: (value: number) => void) {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loading) return loading;
  loading = (async () => {
    const instance = new FFmpeg();
    recentLogs = [];
    instance.on('log', ({ message }) => {
      recentLogs.push(message);
      if (recentLogs.length > 30) recentLogs.shift();
    });
    instance.on('progress', ({ progress }) => onProgress(Math.max(1, Math.min(99, progress * 100))));
    const appBase = new URL(import.meta.env.BASE_URL, window.location.href);
    const coreURL = new URL('ffmpeg/ffmpeg-core.js', appBase).href;
    const wasmURL = new URL('ffmpeg/ffmpeg-core.wasm', appBase).href;
    await instance.load({ coreURL, wasmURL });
    ffmpeg = instance;
    return instance;
  })();
  try { return await loading; } finally { loading = null; }
}

export async function cancelMedia() {
  if (ffmpeg) { ffmpeg.terminate(); ffmpeg = null; }
}

const videoExt = (format: string) => format === 'gif' ? 'gif' : format === 'webm' ? 'webm' : 'mp4';
const audioExt = (format: string) => ['wav','mp3','aac','m4a','ogg','opus'].includes(format) ? format : 'mp3';

export async function processMedia(meta: FileMeta, settings: Settings, index: number, onProgress: (value: number) => void) {
  const engine = await getFFmpeg(onProgress);
  const inputExt = meta.extension || (meta.kind === 'video' ? 'mp4' : 'mp3');
  const input = `input-${meta.id}.${inputExt}`;
  const extractingAudio = settings.operation === 'extract-audio';
  const thumbnail = settings.operation === 'thumbnail';
  const gif = settings.operation === 'gif';
  const outputExt = thumbnail ? 'jpg' : extractingAudio ? audioExt(settings.outputFormat) : meta.kind === 'audio' ? audioExt(settings.outputFormat) : videoExt(settings.outputFormat);
  const output = `output-${meta.id}.${outputExt}`;
  await engine.writeFile(input, await fetchFile(meta.file));
  const args: string[] = ['-i', input];
  if (settings.startTime) args.push('-ss', settings.startTime);
  if (settings.endTime) args.push('-to', settings.endTime);
  if (thumbnail) args.push('-frames:v', '1', '-q:v', '2');
  else if (gif) {
    args.push('-vf', `${scaleFilter(settings.resolution)},fps=${Math.min(settings.framerate || 12, 15)}`, '-loop', '0');
  } else if (extractingAudio || meta.kind === 'audio') {
    args.push('-vn', '-b:a', `${settings.bitrate || 192}k`);
    if (settings.audioChannels !== 'keep') args.push('-ac', settings.audioChannels === 'mono' ? '1' : '2');
  } else {
    args.push('-vf', scaleFilter(settings.resolution));
    if (settings.framerate) args.push('-r', String(settings.framerate));
    if (settings.removeAudio) args.push('-an');
    const crf = settings.videoQuality === 'high' ? '20' : settings.videoQuality === 'small' ? '32' : '26';
    if (outputExt === 'webm') args.push('-c:v', 'libvpx-vp9', '-crf', crf, '-b:v', '0');
    else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    if (!settings.removeAudio) args.push('-c:a', outputExt === 'webm' ? 'libopus' : 'aac', '-b:a', '128k');
    if (settings.bitrate) args.push('-maxrate', `${settings.bitrate}k`, '-bufsize', `${settings.bitrate * 2}k`);
  }
  args.push(output);
  try {
    const exitCode = await engine.exec(args);
    if (exitCode !== 0) throw new Error(ffmpegError());
    const data = await engine.readFile(output);
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    const mime = thumbnail ? 'image/jpeg' : gif ? 'image/gif' : meta.kind === 'audio' || extractingAudio ? `audio/${outputExt}` : `video/${outputExt}`;
    const blob = new Blob([bytes.slice().buffer], { type: mime });
    onProgress(100);
    return { blob, name: outputName(meta.file, settings, index, outputExt) };
  } finally {
    try { await engine.deleteFile(input); } catch { /* already released */ }
    try { await engine.deleteFile(output); } catch { /* no output after cancellation */ }
  }
}

function scaleFilter(resolution: string) {
  const heights: Record<string, number> = { '2160p': 2160, '1080p': 1080, '720p': 720, '480p': 480 };
  if (resolution === 'original') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
  const height = heights[resolution] || 1080;
  return `scale=trunc(iw*min(1\\,${height}/ih)/2)*2:trunc(ih*min(1\\,${height}/ih)/2)*2`;
}

function ffmpegError() {
  const useful = recentLogs.filter(line => /error|invalid|failed|unknown|not found|unable/i.test(line)).slice(-4);
  return useful.length ? `FFmpeg : ${useful.join(' · ')}` : 'FFmpeg n’a pas pu convertir ce fichier. Vérifiez que la piste vidéo est lisible.';
}
