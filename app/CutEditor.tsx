import { useEffect, useRef, useState } from 'react';
import { ArrowLeftToLine, ArrowRightToLine, ChevronDown, Film, LoaderCircle, Play, Plus, Trash2 } from 'lucide-react';
import type { FileMeta, Segment, Settings } from '../src/types';
import { formatTime, parseTime, segmentBounds } from '../src/core/files';

interface Props { meta?: FileMeta; count: number; settings: Settings; setSettings: (s: Settings) => void; busy: boolean }

export function CutEditor({ meta, count, settings, setSettings, busy }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stopAt = useRef<number | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyProgress, setProxyProgress] = useState<number | null>(null);
  const [proxyKeyframes, setProxyKeyframes] = useState(false);
  const [unplayable, setUnplayable] = useState(false);
  const [playerError, setPlayerError] = useState('');
  const [time, setTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [active, setActive] = useState(0);

  const segments = settings.segments.length ? settings.segments : [{ start: '', end: '' }];
  const duration = meta?.duration || videoDuration || undefined;
  const activeIndex = Math.min(active, segments.length - 1);

  useEffect(() => {
    if (!meta) return;
    const url = URL.createObjectURL(meta.file);
    setSourceUrl(url); setProxyUrl(''); setUnplayable(false); setPlayerError(''); setTime(0);
    return () => URL.revokeObjectURL(url);
  }, [meta]);

  useEffect(() => () => { if (proxyUrl) URL.revokeObjectURL(proxyUrl); }, [proxyUrl]);

  const setSegments = (next: Segment[]) => setSettings({ ...settings, segments: next });
  const patchSegment = (index: number, data: Partial<Segment>) => setSegments(segments.map((segment, i) => i === index ? { ...segment, ...data } : segment));

  function addSegment(start = segments[segments.length - 1]?.end || '') {
    setSegments([...segments, { start, end: '' }]);
    setActive(segments.length);
  }

  function removeSegment(index: number) {
    setSegments(segments.filter((_, i) => i !== index));
    setActive(current => Math.max(0, current > index ? current - 1 : current === index ? index - 1 : current));
  }

  function seek(seconds: number) {
    const video = videoRef.current; if (!video) return;
    stopAt.current = null;
    video.currentTime = Math.max(0, seconds); setTime(video.currentTime);
  }

  function playSegment(index: number) {
    const video = videoRef.current; if (!video) return;
    const start = parseTime(segments[index].start) ?? 0;
    const end = parseTime(segments[index].end) ?? duration;
    if (Number.isNaN(start)) return;
    setActive(index); seek(start);
    stopAt.current = end != null && !Number.isNaN(end) ? end : null;
    void video.play();
  }

  function onTimeUpdate() {
    const video = videoRef.current; if (!video) return;
    setTime(video.currentTime);
    if (stopAt.current != null && video.currentTime >= stopAt.current) { video.pause(); stopAt.current = null; }
  }

  async function buildProxy() {
    if (!meta) return;
    setProxyProgress(1); setPlayerError('');
    try {
      const { createPreview } = await import('../src/media/ffmpeg');
      const preview = await createPreview(meta, value => setProxyProgress(Math.round(value)));
      setProxyUrl(URL.createObjectURL(preview.blob)); setProxyKeyframes(preview.keyframesOnly); setUnplayable(false);
    } catch (error) {
      setPlayerError(error instanceof Error ? error.message : 'Impossible de créer l’aperçu.');
    } finally { setProxyProgress(null); }
  }

  // I / O mark the active interval while the editor is shown; the ref keeps the listener on fresh state.
  const shortcut = useRef<(event: KeyboardEvent) => void>(() => {});
  shortcut.current = event => {
    if (!meta || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (key === 'i') patchSegment(activeIndex, { start: formatTime(time) });
    else if (key === 'o') patchSegment(activeIndex, { end: formatTime(time) });
    else return;
    event.preventDefault();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => shortcut.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  let total = 0;
  let validation = '';
  try { total = segmentBounds(segments, duration).reduce((sum, { start, end }) => sum + end - start, 0); }
  catch (error) { validation = error instanceof Error ? error.message : ''; }

  const src = proxyUrl || sourceUrl;
  return <div className="cut-editor">
    {meta && <div className="cut-player">
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- preview of the user's own footage, no caption track to offer */}
      <video ref={videoRef} src={src} controls playsInline preload="metadata"
        onLoadedMetadata={e => { const video = e.currentTarget; setVideoDuration(video.duration); if (!proxyUrl && !video.videoWidth) setUnplayable(true); }}
        onError={() => { if (!proxyUrl) setUnplayable(true); }}
        onTimeUpdate={onTimeUpdate} onSeeked={onTimeUpdate}/>
      {unplayable && proxyProgress == null && <div className="cut-overlay"><Film size={22}/><span>Ce navigateur ne sait pas lire cette vidéo.</span><button type="button" onClick={buildProxy} disabled={busy}>Générer un aperçu allégé</button></div>}
      {proxyProgress != null && <div className="cut-overlay"><LoaderCircle className="spin" size={22}/><span>Aperçu allégé · {proxyProgress} %</span></div>}
    </div>}
    {meta && <Timeline duration={duration} time={time} segments={segments} active={activeIndex} onSeek={seek} onSelect={setActive}/>}
    {meta && <div className="cut-controls">
      <code>{formatTime(time)}</code>
      <button type="button" onClick={() => patchSegment(activeIndex, { start: formatTime(time) })} title="Début de l’intervalle actif à la position courante (touche I)"><ArrowLeftToLine size={14}/> Début ici</button>
      <button type="button" onClick={() => patchSegment(activeIndex, { end: formatTime(time) })} title="Fin de l’intervalle actif à la position courante (touche O)"><ArrowRightToLine size={14}/> Fin ici</button>
      <button type="button" onClick={() => addSegment(formatTime(time))} title="Nouvel intervalle commençant à la position courante"><Plus size={14}/> Nouveau ici</button>
    </div>}
    {meta && !unplayable && !proxyUrl && proxyProgress == null && <button type="button" className="cut-proxy-link" onClick={buildProxy} disabled={busy}>Lecture saccadée ? Générer un aperçu allégé (360p)</button>}
    {proxyUrl && proxyKeyframes && <p className="helper">Aperçu allégé : seules les images clés sont affichées, ce sont aussi les points de coupe du mode sans perte.</p>}
    {playerError && <p className="cut-error">{playerError}</p>}

    <div className="segment-list">
      {segments.map((segment, index) => <div className={`segment-row ${index === activeIndex ? 'active' : ''}`} key={index} role="group" aria-label={`Intervalle ${index + 1}`}>
        <button type="button" className="segment-index" onClick={() => setActive(index)} title="Rendre cet intervalle actif">{index + 1}</button>
        <label><span>Début</span><input value={segment.start} onFocus={() => setActive(index)} onChange={e => patchSegment(index, { start: e.target.value })} placeholder="0:00.00"/></label>
        <label><span>Fin</span><input value={segment.end} onFocus={() => setActive(index)} onChange={e => patchSegment(index, { end: e.target.value })} placeholder={duration ? formatTime(duration) : 'Fin de la vidéo'}/></label>
        {meta && <button type="button" className="icon-btn" onClick={() => playSegment(index)} title="Lire cet intervalle"><Play size={14}/></button>}
        <button type="button" className="icon-btn" disabled={segments.length === 1} onClick={() => removeSegment(index)} title="Supprimer l’intervalle"><Trash2 size={14}/></button>
      </div>)}
      <button type="button" className="add-zone" onClick={() => addSegment()}><Plus size={16}/> Ajouter un intervalle</button>
      <p className={validation ? 'cut-error' : 'helper'}>{validation || `${segments.length} intervalle${segments.length > 1 ? 's' : ''} mis bout à bout · durée totale ${formatTime(total)}`}</p>
    </div>

    <div className="form-grid">
      <label className="field"><span>Mode de coupe</span><select value={settings.cutMode} onChange={e => setSettings({ ...settings, cutMode: e.target.value as Settings['cutMode'] })}><option value="copy">Sans perte (rapide)</option><option value="precise">Précis (réencodage)</option></select><ChevronDown size={15}/></label>
      <label className="field"><span>Nom du fichier de sortie</span><input value={settings.outputBaseName} onChange={e => setSettings({ ...settings, outputBaseName: e.target.value })} placeholder="Nom d’origine"/></label>
      <p className="helper full">{settings.cutMode === 'copy'
        ? 'Les flux d’origine sont copiés tels quels : même format, même qualité, métadonnées conservées. Chaque coupe démarre sur l’image clé précédente, donc parfois une fraction de seconde plus tôt.'
        : `Coupe à l’image près. La vidéo est réencodée (H.264/AAC, ou VP9/Opus pour WebM) dans le même conteneur, avec la même résolution et les métadonnées d’origine.${(meta?.height || 0) > 1080 || (meta?.file.size || 0) > 300_000_000 ? ' Sur une vidéo de cette taille, le réencodage dans le navigateur est très lent : comptez plusieurs minutes par dizaine de secondes.' : ''}`}
        {count > 1 && ` Les intervalles s’appliquent à chacune des ${count} vidéos sélectionnées ; l’aperçu montre la première.`}</p>
    </div>
  </div>;
}

function Timeline({ duration, time, segments, active, onSeek, onSelect }: { duration?: number; time: number; segments: Segment[]; active: number; onSeek: (s: number) => void; onSelect: (i: number) => void }) {
  if (!duration) return null;
  const pct = (seconds: number) => `${Math.max(0, Math.min(100, seconds / duration * 100))}%`;
  const ranges = segments.map(segment => {
    const start = parseTime(segment.start) ?? 0;
    const end = parseTime(segment.end) ?? duration;
    return Number.isNaN(start) || Number.isNaN(end) || end <= start ? null : { start, end };
  });
  function seekTo(seconds: number) {
    const hit = ranges.findIndex(range => range && seconds >= range.start && seconds <= range.end);
    if (hit >= 0) onSelect(hit);
    onSeek(seconds);
  }
  return <div className="cut-timeline" role="slider" tabIndex={0} aria-label="Position de lecture" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} aria-valuetext={formatTime(time)}
    onClick={e => { const box = e.currentTarget.getBoundingClientRect(); seekTo((e.clientX - box.left) / box.width * duration); }}
    onKeyDown={e => { const step = e.shiftKey ? 5 : 1; if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(time - step); } if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(time + step); } }}>
    {ranges.map((range, index) => range && <span key={index} className={index === active ? 'active' : ''} style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }}>{index + 1}</span>)}
    <i style={{ left: pct(time) }}/>
  </div>;
}
