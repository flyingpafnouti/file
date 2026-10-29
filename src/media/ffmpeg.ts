import { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg';
import type { FileMeta, Settings } from '../types';
import { outputName, segmentBounds } from '../core/files';

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;
let recentLogs: string[] = [];
// The listener is registered once per instance, so each job swaps in its own progress callback.
let reportProgress: (ratio: number) => void = () => {};

async function getFFmpeg() {
  if (ffmpeg?.loaded) return ffmpeg;
  if (loading) return loading;
  loading = (async () => {
    const instance = new FFmpeg();
    recentLogs = [];
    instance.on('log', ({ message }) => {
      recentLogs.push(message);
      if (recentLogs.length > 30) recentLogs.shift();
    });
    instance.on('progress', ({ progress }) => reportProgress(progress));
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
const percent = (ratio: number) => Math.max(1, Math.min(99, ratio * 100));

export async function processMedia(meta: FileMeta, settings: Settings, index: number, onProgress: (value: number) => void) {
  const engine = await getFFmpeg();
  reportProgress = ratio => onProgress(percent(ratio));
  const source = await mountInput(engine, meta.file);
  const input = source.path;
  const extractingAudio = settings.operation === 'extract-audio';
  const thumbnail = settings.operation === 'thumbnail';
  const gif = settings.operation === 'gif';
  const outputExt = thumbnail ? 'jpg' : extractingAudio ? audioExt(settings.outputFormat) : meta.kind === 'audio' ? audioExt(settings.outputFormat) : videoExt(settings.outputFormat);
  const output = `output-${meta.id}.${outputExt}`;
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
    await run(engine, args);
    const mime = thumbnail ? 'image/jpeg' : gif ? 'image/gif' : meta.kind === 'audio' || extractingAudio ? `audio/${outputExt}` : `video/${outputExt}`;
    const blob = await readBlob(engine, output, mime);
    onProgress(100);
    return { blob, name: outputName(meta.file, settings, index, outputExt) };
  } finally {
    await release(engine, [output]);
    await source.release();
  }
}

// Cuts each interval, then joins them in list order. Container, extension and global metadata
// come from the source; 'copy' keeps the original streams (cuts snap to the previous keyframe),
// 'precise' re-encodes each interval for frame-accurate cuts.
export async function cutMedia(meta: FileMeta, settings: Settings, index: number, onProgress: (value: number) => void) {
  const segments = segmentBounds(settings.segments, meta.duration);
  if (settings.cutMode === 'copy' && meta.duration) {
    // Stream copy keeps the source bitrate; parts and joined output both live in wasm memory.
    const kept = segments.reduce((sum, { start, end }) => sum + end - start, 0) / meta.duration;
    const footprint = meta.file.size * kept * (segments.length > 1 ? 2 : 1);
    if (footprint > 2_000_000_000) throw new Error(`Les intervalles représentent environ ${(meta.file.size * kept / 1e9).toFixed(1)} Go à copier, trop pour la mémoire du navigateur. Réduisez-les ou traitez-les en plusieurs fois.`);
  }
  const engine = await getFFmpeg();
  const ext = meta.extension || 'mp4';
  const parts = segments.map((_, i) => `part-${meta.id}-${i}.${ext}`);
  const list = `parts-${meta.id}.txt`;
  const output = `output-${meta.id}.${ext}`;
  const steps = segments.length > 1 ? segments.length + 1 : 1;
  const codecs = settings.cutMode === 'precise' ? preciseCodecs(ext) : ['-c', 'copy'];
  const movFlags = ['mp4', 'mov', 'm4v', '3gp'].includes(ext) ? ['-movflags', 'use_metadata_tags'] : [];
  const source = await mountInput(engine, meta.file);
  const input = source.path;
  const cutArgs = ({ start, end }: { start: number; end: number }) => ['-ss', start.toFixed(3), '-i', input, '-t', (end - start).toFixed(3), '-map', '0:v:0?', '-map', '0:a?', ...codecs, '-avoid_negative_ts', 'make_zero'];
  try {
    if (segments.length === 1) {
      reportProgress = ratio => onProgress(percent(ratio));
      await run(engine, [...cutArgs(segments[0]), '-map_metadata', '0', ...movFlags, output]);
    } else {
      for (const [i, segment] of segments.entries()) {
        reportProgress = ratio => onProgress(percent((i + Math.max(0, Math.min(1, ratio))) / steps));
        await run(engine, [...cutArgs(segment), parts[i]]);
      }
      await engine.writeFile(list, parts.map(part => `file '${part}'`).join('\n'));
      reportProgress = () => onProgress(percent(segments.length / steps));
      await run(engine, ['-f', 'concat', '-safe', '0', '-i', list, '-i', input, '-map', '0', '-map_metadata', '1', '-c', 'copy', ...movFlags, output]);
      await release(engine, parts);
    }
    const blob = await readBlob(engine, output, meta.file.type || `video/${ext}`);
    onProgress(100);
    return { blob, name: outputName(meta.file, settings, index, ext) };
  } finally {
    await release(engine, [list, output, ...parts]);
    await source.release();
  }
}

// Low-resolution proxy for browsers that cannot decode the source (HEVC, ProRes…). Timestamps match the source.
// Large or high-resolution files only decode keyframes: full decoding of 4K in wasm would take tens of minutes,
// and keyframes are exactly where lossless cuts land.
export async function createPreview(meta: FileMeta, onProgress: (value: number) => void) {
  const keyframesOnly = meta.file.size > 300_000_000 || (meta.width || 0) * (meta.height || 0) > 1920 * 1080;
  const engine = await getFFmpeg();
  reportProgress = ratio => onProgress(percent(ratio));
  const source = await mountInput(engine, meta.file);
  const output = `preview-${meta.id}.mp4`;
  const video = keyframesOnly ? ['-vf', 'scale=-2:min(360\\,ih)', '-vsync', 'vfr'] : ['-vf', 'scale=-2:min(360\\,ih),fps=15'];
  try {
    await run(engine, [...(keyframesOnly ? ['-skip_frame', 'nokey'] : []), '-i', source.path, '-map', '0:v:0', '-map', '0:a:0?', ...video, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', output]);
    return { blob: await readBlob(engine, output, 'video/mp4'), keyframesOnly };
  } finally {
    await release(engine, [output]);
    await source.release();
  }
}

// Mounts the File read-only (WORKERFS): FFmpeg reads it lazily instead of copying it into wasm memory,
// so multi-gigabyte sources work.
async function mountInput(engine: FFmpeg, file: File) {
  const dir = `/input-${crypto.randomUUID()}`;
  await engine.createDir(dir);
  await engine.mount(FFFSType.WORKERFS, { files: [file] }, dir);
  return {
    path: `${dir}/${file.name}`,
    release: async () => {
      try { await engine.unmount(dir); await engine.deleteDir(dir); } catch { /* engine terminated */ }
    },
  };
}

function preciseCodecs(ext: string) {
  if (ext === 'webm') return ['-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-c:a', 'libopus', '-b:a', '160k'];
  return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'];
}

async function run(engine: FFmpeg, args: string[]) {
  if (await engine.exec(args) !== 0) throw new Error(ffmpegError());
}

async function readBlob(engine: FFmpeg, path: string, type: string) {
  const data = await engine.readFile(path);
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
  return new Blob([bytes.slice().buffer], { type });
}

async function release(engine: FFmpeg, paths: string[]) {
  for (const path of paths) {
    try { await engine.deleteFile(path); } catch { /* never written or already released */ }
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
