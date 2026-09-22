'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, ChevronDown, CircleX, Download, FileAudio, FileImage, FileText, FileUp, FileVideo, FolderOpen, LoaderCircle, LockKeyhole, Play, Plus, Save, Sparkles, Trash2, X, Zap } from 'lucide-react';
import type { FileKind, FileMeta, QueueItem, ResultFile, Settings } from '../src/types';
import { baseName, formatBytes, formatDuration, inspectFile, outputName, sha256 } from '../src/core/files';
import { processImage } from '../src/image/processImage';
import { createZip, extractZip, listZip } from '../src/archive/zip';
import { editPdf, imagesToPdf, mergePdfs } from '../src/pdf/pdf';
import { builtInPresets, defaultSettings, getCustomPresets, saveCustomPreset } from '../src/presets';

const kindLabels: Record<FileKind, string> = { image: 'Image', video: 'Vidéo', audio: 'Audio', pdf: 'PDF', zip: 'Archive', other: 'Fichier' };
const operations: Record<FileKind, Array<[string, string]>> = {
  image: [['convert','Convertir / compresser'],['images-pdf','Créer un PDF'],['rename','Renommer'],['hash','Calculer SHA-256'],['create-zip','Créer un ZIP']],
  video: [['convert','Convertir / compresser'],['extract-audio','Extraire l’audio'],['thumbnail','Créer une miniature'],['gif','Extrait en GIF'],['rename','Renommer'],['hash','Calculer SHA-256']],
  audio: [['convert','Convertir / compresser'],['rename','Renommer'],['hash','Calculer SHA-256']],
  pdf: [['merge-pdf','Fusionner'],['extract-pages','Extraire des pages'],['remove-pages','Supprimer des pages'],['rotate-pages','Tourner des pages'],['rename','Renommer'],['hash','Calculer SHA-256']],
  zip: [['extract-zip','Extraire'],['hash','Calculer SHA-256'],['rename','Renommer']],
  other: [['create-zip','Créer un ZIP'],['rename','Renommer'],['hash','Calculer SHA-256']],
};

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelled = useRef(new Set<string>());
  const [files, setFiles] = useState<FileMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [results, setResults] = useState<ResultFile[]>([]);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState('');
  const [pages, setPages] = useState('1');
  const [customPresets, setCustomPresets] = useState(getCustomPresets);
  const [zipContents, setZipContents] = useState<Array<{name:string;size:number}>>([]);
  const [previewResult, setPreviewResult] = useState<ResultFile | null>(null);

  const activeFiles = useMemo(() => files.filter(file => selected.has(file.id)), [files, selected]);
  const activeKind = activeFiles[0]?.kind || files[0]?.kind || 'image';
  const isMedia = activeKind === 'video' || activeKind === 'audio';

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const pasted = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
      if (pasted.length) void addFiles(pasted);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  async function addFiles(incoming: File[] | FileList) {
    const list = Array.from(incoming);
    if (!list.length) return;
    setNotice(`Analyse de ${list.length} fichier${list.length > 1 ? 's' : ''}…`);
    const inspected = await Promise.all(list.map(inspectFile));
    setFiles(previous => [...previous, ...inspected]);
    setSelected(previous => new Set([...previous, ...inspected.map(item => item.id)]));
    const first = inspected[0];
    const op = operations[first.kind][0][0];
    setSettings(current => ({ ...current, operation: op, outputFormat: first.kind === 'video' ? 'mp4' : first.kind === 'audio' ? 'mp3' : current.outputFormat }));
    setNotice('');
    if (first.kind === 'zip') listZip(first.file).then(setZipContents).catch(() => setZipContents([]));
  }

  function removeFile(id: string) {
    const target = files.find(file => file.id === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    setFiles(current => current.filter(file => file.id !== id));
    setSelected(current => { const next = new Set(current); next.delete(id); return next; });
    setResults(current => current.filter(result => result.sourceId !== id));
  }

  function patchQueue(id: string, patch: Partial<QueueItem>) {
    setQueue(current => current.map(item => item.id === id ? { ...item, ...patch } : item));
  }

  async function run() {
    if (!activeFiles.length || running) return;
    setRunning(true); setNotice(''); cancelled.current.clear();
    const jobs = activeFiles.map(file => ({ id: crypto.randomUUID(), sourceId: file.id, name: file.file.name, operation: operationLabel(settings.operation), progress: 0, status: 'Waiting' as const }));
    setQueue(current => [...jobs, ...current].slice(0, 80));
    try {
      if (settings.operation === 'merge-pdf') {
        const job = jobs[0]; patchQueue(job.id, { status: 'Processing', progress: 30 });
        const blob = await mergePdfs(activeFiles.filter(f => f.kind === 'pdf').map(f => f.file));
        addResult({ sourceId: job.sourceId, name: 'documents-fusionnes.pdf', blob }); patchQueue(job.id, { status: 'Done', progress: 100 });
      } else if (settings.operation === 'images-pdf') {
        const job = jobs[0]; patchQueue(job.id, { status: 'Processing', progress: 20 });
        const compatible = await Promise.all(activeFiles.map(async meta => {
          if (['image/jpeg','image/png'].includes(meta.file.type)) return meta.file;
          const converted = await processImage(meta, { ...settings, outputFormat: 'jpeg', maxWidth: meta.width || 4000, maxHeight: meta.height || 4000 }, 0);
          return new File([converted.blob], `${baseName(meta.file.name)}.jpg`, { type: 'image/jpeg' });
        }));
        const blob = await imagesToPdf(compatible); addResult({ sourceId: job.sourceId, name: 'images.pdf', blob }); patchQueue(job.id, { status: 'Done', progress: 100 });
      } else if (settings.operation === 'create-zip') {
        const job = jobs[0]; patchQueue(job.id, { status: 'Processing', progress: 5 });
        const blob = await createZip(activeFiles.map(f => ({ name: f.file.name, blob: f.file })), value => patchQueue(job.id, { progress: Math.round(value) }));
        addResult({ sourceId: job.sourceId, name: 'filelab-archive.zip', blob }); patchQueue(job.id, { status: 'Done', progress: 100 });
      } else {
        for (let index = 0; index < activeFiles.length; index++) await runOne(activeFiles[index], jobs[index], index);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Le traitement a échoué.';
      setNotice(message); setQueue(current => current.map(item => item.status === 'Processing' || item.status === 'Waiting' ? { ...item, status: 'Error', error: message } : item));
    } finally { setRunning(false); }
  }

  async function runOne(meta: FileMeta, job: QueueItem, index: number) {
    patchQueue(job.id, { status: 'Processing', progress: 2 });
    if (cancelled.current.has(job.id)) return patchQueue(job.id, { status: 'Cancelled' });
    try {
      if (settings.operation === 'convert' && meta.kind === 'image') {
        const out = await processImage(meta, settings, index); addResult({ sourceId: meta.id, ...out });
      } else if ((meta.kind === 'video' || meta.kind === 'audio') && ['convert','extract-audio','thumbnail','gif'].includes(settings.operation)) {
        if (meta.file.size > 1_000_000_000) throw new Error('Ce fichier dépasse 1 Go et risque d’épuiser la mémoire du navigateur.');
        const { processMedia } = await import('../src/media/ffmpeg');
        const out = await processMedia(meta, settings, index, progress => patchQueue(job.id, { progress: Math.round(progress) })); addResult({ sourceId: meta.id, ...out });
      } else if (settings.operation === 'extract-zip') {
        const extracted = await extractZip(meta.file); extracted.forEach(item => addResult({ ...item, sourceId: meta.id }));
      } else if (['extract-pages','remove-pages','rotate-pages'].includes(settings.operation)) {
        const mode = settings.operation === 'extract-pages' ? 'extract' : settings.operation === 'remove-pages' ? 'remove' : 'rotate';
        const blob = await editPdf(meta.file, pages, mode); addResult({ sourceId: meta.id, name: `${baseName(meta.file.name)}-${mode}.pdf`, blob });
      } else if (settings.operation === 'hash') {
        const hash = await sha256(meta.file); setFiles(current => current.map(file => file.id === meta.id ? { ...file, hash } : file));
      } else if (settings.operation === 'rename') {
        addResult({ sourceId: meta.id, name: outputName(meta.file, settings, index, meta.extension || 'bin'), blob: meta.file });
      } else throw new Error('Cette opération ne correspond pas au type sélectionné.');
      patchQueue(job.id, { status: 'Done', progress: 100 });
    } catch (error) {
      if (cancelled.current.has(job.id)) patchQueue(job.id, { status: 'Cancelled', progress: 0 });
      else {
        const message = error instanceof Error ? error.message : 'Erreur';
        patchQueue(job.id, { status: 'Error', error: message });
        setNotice(message);
      }
    }
  }

  function addResult(data: Omit<ResultFile, 'id'>) {
    const result: ResultFile = { ...data, id: crypto.randomUUID() };
    if (data.blob.type.startsWith('image/')) result.previewUrl = URL.createObjectURL(data.blob);
    setResults(current => [result, ...current]);
    if (result.previewUrl) setPreviewResult(result);
  }

  async function cancelJob(job: QueueItem) {
    cancelled.current.add(job.id); patchQueue(job.id, { status: 'Cancelled', progress: 0 });
    if (job.status === 'Processing' && isMedia) { const { cancelMedia } = await import('../src/media/ffmpeg'); await cancelMedia(); setRunning(false); }
  }

  function download(result: ResultFile) {
    const url = URL.createObjectURL(result.blob); const link = document.createElement('a'); link.href = url; link.download = result.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadAll() {
    if (!results.length) return;
    if (results.length === 1) return download(results[0]);
    const blob = await createZip(results.map(result => ({ name: result.name, blob: result.blob })));
    download({ id: 'all', sourceId: '', name: 'filelab-resultats.zip', blob });
  }

  function applyPreset(id: string) {
    const preset = [...builtInPresets, ...customPresets].find(item => item.id === id);
    if (preset) setSettings(current => ({ ...current, ...preset.settings }));
  }

  function savePreset() {
    const name = window.prompt('Nom du preset'); if (!name) return;
    const preset = { id: crypto.randomUUID(), name, kind: activeKind, settings } as const;
    saveCustomPreset(preset); setCustomPresets(getCustomPresets()); setNotice(`Preset « ${name} » enregistré sur cet appareil.`);
  }

  return <main className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => window.scrollTo({top:0,behavior:'smooth'})}><span className="brand-mark"><Sparkles size={18}/></span><span>FileLab</span></button>
      <div className="top-actions"><span className="privacy-pill"><LockKeyhole size={14}/> 100 % local — vos fichiers ne quittent jamais votre appareil</span>{files.length > 0 && <button className="ghost-btn" onClick={() => inputRef.current?.click()}><Plus size={16}/> Ajouter</button>}</div>
    </header>

    {files.length === 0 ? <section className="workspace landing">
      <div className="intro"><p className="eyebrow"><Zap size={14}/> Votre atelier de fichiers</p><h1>Transformez vos fichiers.<br/><span>Gardez-les pour vous.</span></h1><p>Images, vidéos, audio, PDF et archives sont traités directement sur votre appareil.</p></div>
      <DropZone inputRef={inputRef} onFiles={addFiles}/>
      <div className="preset-strip"><span>Presets rapides</span>{builtInPresets.map(preset => <button key={preset.id} onClick={() => { applyPreset(preset.id); inputRef.current?.click(); }}>{preset.name}</button>)}</div>
    </section> : <section className="workbench">
      <aside className="file-panel panel">
        <div className="panel-head"><div><span className="kicker">Fichiers</span><h2>{files.length} élément{files.length > 1 ? 's' : ''}</h2></div><button className="icon-btn" title="Tout supprimer" onClick={() => { files.forEach(f => f.previewUrl && URL.revokeObjectURL(f.previewUrl)); setFiles([]); setSelected(new Set()); setResults([]); }}><Trash2 size={16}/></button></div>
        <div className="select-row"><label><input type="checkbox" checked={selected.size === files.length} onChange={e => setSelected(e.target.checked ? new Set(files.map(f => f.id)) : new Set())}/> Tout sélectionner</label><span>{formatBytes(activeFiles.reduce((sum,f) => sum + f.file.size,0))}</span></div>
        <div className="file-list">{files.map(file => <article className={`file-card ${selected.has(file.id) ? 'selected' : ''}`} key={file.id}>
          <input type="checkbox" checked={selected.has(file.id)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(file.id)) next.delete(file.id); else next.add(file.id); return next; })}/>
          {file.previewUrl ? <img src={file.previewUrl} alt=""/> : <span className="file-icon">{kindIcon(file.kind)}</span>}
          <div className="file-main"><strong title={file.file.name}>{file.file.name}</strong><span>{kindLabels[file.kind]} · {formatBytes(file.file.size)}{file.width ? ` · ${file.width}×${file.height}` : ''}{file.duration ? ` · ${formatDuration(file.duration)}` : ''}</span>{file.hash && <code title={file.hash}>SHA-256 {file.hash.slice(0,14)}…</code>}</div>
          <button className="bare" onClick={() => removeFile(file.id)} aria-label={`Supprimer ${file.file.name}`}><X size={15}/></button>
        </article>)}</div>
        <button className="add-zone" onClick={() => inputRef.current?.click()}><FileUp size={17}/> Ajouter des fichiers</button>
      </aside>

      <section className="settings-panel panel">
        <div className="panel-head"><div><span className="kicker">Opération</span><h2>{kindLabels[activeKind]}</h2></div><span className="count-chip">{activeFiles.length} sélectionné{activeFiles.length > 1 ? 's' : ''}</span></div>
        <label className="field full"><span>Action</span><select value={settings.operation} onChange={e => setSettings({...settings, operation:e.target.value})}>{operations[activeKind].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={15}/></label>
        <div className="preset-grid">{[...builtInPresets,...customPresets].filter(p => p.kind === activeKind).map(preset => <button key={preset.id} onClick={() => applyPreset(preset.id)} className="preset-card"><Sparkles size={15}/><span>{preset.name}</span></button>)}</div>
        <SettingsForm kind={activeKind} settings={settings} setSettings={setSettings} pages={pages} setPages={setPages}/>
        {activeKind === 'zip' && zipContents.length > 0 && <div className="archive-list"><strong>Contenu de l’archive</strong>{zipContents.slice(0,8).map(item => <span key={item.name}>{item.name}<small>{formatBytes(item.size)}</small></span>)}{zipContents.length > 8 && <em>+ {zipContents.length - 8} autres fichiers</em>}</div>}
        <div className="settings-actions"><button className="secondary-btn" onClick={savePreset}><Save size={16}/> Enregistrer le preset</button><button className="primary-btn" disabled={!activeFiles.length || running} onClick={run}>{running ? <LoaderCircle className="spin" size={18}/> : <Play size={18}/>} {running ? 'Traitement…' : 'Lancer'}</button></div>
        {notice && <output className="notice">{notice}</output>}
      </section>

      <aside className="queue-panel panel">
        <div className="panel-head"><div><span className="kicker">Activité</span><h2>Queue</h2></div>{results.length > 0 && <button className="download-all" onClick={downloadAll}><Download size={15}/> Tout télécharger</button>}</div>
        {previewResult && activeFiles[0]?.previewUrl && <div className="comparison"><div><span>Avant</span><img src={activeFiles[0].previewUrl} alt="Avant traitement"/></div><div><span>Après</span><img src={previewResult.previewUrl} alt="Après traitement"/></div></div>}
        <div className="queue-list">{queue.length === 0 ? <div className="empty-state"><Archive size={28}/><strong>La file est vide</strong><span>Vos traitements apparaîtront ici.</span></div> : queue.map(job => { const result = results.find(r => r.sourceId === job.sourceId); return <article className="queue-item" key={job.id}>
          <div className={`status-icon ${job.status.toLowerCase()}`}>{job.status === 'Done' ? <Check size={14}/> : job.status === 'Error' ? <CircleX size={14}/> : job.status === 'Processing' ? <LoaderCircle className="spin" size={14}/> : <Archive size={14}/>}</div>
          <div className="queue-main"><strong>{job.name}</strong><span>{job.operation} · {job.status}</span><div className="progress"><i style={{width:`${job.progress}%`}}/></div>{job.error && <small>{job.error}</small>}</div>
          {result ? <button className="icon-btn" onClick={() => download(result)} title="Télécharger"><Download size={15}/></button> : ['Waiting','Processing'].includes(job.status) ? <button className="icon-btn" onClick={() => cancelJob(job)} title="Annuler"><X size={15}/></button> : null}
        </article>})}</div>
        {results.length > 0 && <div className="results-summary"><strong>{results.length} résultat{results.length > 1 ? 's' : ''}</strong><span>{formatBytes(results.reduce((sum,r) => sum+r.blob.size,0))}</span></div>}
      </aside>
    </section>}
    <input ref={inputRef} className="visually-hidden" type="file" multiple onChange={e => { if(e.target.files) void addFiles(e.target.files); e.target.value=''; }}/>
    <footer><LockKeyhole size={13}/> Aucun upload, aucun compte, aucune télémétrie.</footer>
  </main>;
}

function DropZone({ inputRef, onFiles }: { inputRef: React.RefObject<HTMLInputElement | null>; onFiles: (files: File[] | FileList) => void }) {
  const [dragging,setDragging] = useState(false);
  return <div className={`dropzone ${dragging?'dragging':''}`} role="button" tabIndex={0} onClick={() => inputRef.current?.click()} onKeyDown={e => { if(e.key==='Enter'||e.key===' ') inputRef.current?.click(); }} onDragEnter={e => {e.preventDefault();setDragging(true)}} onDragOver={e=>e.preventDefault()} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);onFiles(e.dataTransfer.files)}}>
    <div className="drop-icon"><FileUp size={30}/></div><strong>Déposez vos fichiers ici</strong><span>ou collez une image depuis le presse-papiers</span><button type="button" onClick={e=>{e.stopPropagation();inputRef.current?.click()}}><FolderOpen size={17}/> Choisir des fichiers</button><small>JPEG, PNG, WebP, AVIF, MOV, MP4, MP3, PDF, ZIP et plus</small>
  </div>;
}

function SettingsForm({kind,settings,setSettings,pages,setPages}:{kind:FileKind;settings:Settings;setSettings:(s:Settings)=>void;pages:string;setPages:(s:string)=>void}) {
  const patch = (data:Partial<Settings>) => setSettings({...settings,...data});
  if (settings.operation === 'hash' || settings.operation === 'create-zip' || settings.operation === 'extract-zip' || settings.operation === 'merge-pdf' || settings.operation === 'images-pdf') return <p className="helper">Aucun réglage nécessaire. Le résultat sera créé entièrement sur cet appareil.</p>;
  if (settings.operation === 'rename') return <div className="form-grid"><Field label="Préfixe"><input value={settings.prefix} onChange={e=>patch({prefix:e.target.value})} placeholder="vacances-"/></Field><Field label="Suffixe"><input value={settings.suffix} onChange={e=>patch({suffix:e.target.value})} placeholder="-web"/></Field><Field label="Rechercher"><input value={settings.search} onChange={e=>patch({search:e.target.value})}/></Field><Field label="Remplacer"><input value={settings.replace} onChange={e=>patch({replace:e.target.value})}/></Field><label className="check-row"><input type="checkbox" checked={settings.numbering} onChange={e=>patch({numbering:e.target.checked})}/> Numérotation 001, 002…</label></div>;
  if (kind === 'pdf') return <div className="form-grid"><Field label="Pages"><input value={pages} onChange={e=>setPages(e.target.value)} placeholder="1, 3-5, 8"/></Field><p className="helper full">Séparez les pages par des virgules; les intervalles utilisent un tiret.</p></div>;
  if (kind === 'image') return <div className="form-grid">
    <Field label="Format"><select value={settings.outputFormat} onChange={e=>patch({outputFormat:e.target.value})}><option value="webp">WebP</option><option value="jpeg">JPEG</option><option value="png">PNG</option><option value="avif">AVIF (si disponible)</option></select></Field>
    <Field label={`Qualité · ${settings.quality}%`}><input type="range" min="20" max="100" value={settings.quality} onChange={e=>patch({quality:+e.target.value})}/></Field>
    <Field label="Largeur max"><input type="number" min="1" value={settings.maxWidth} onChange={e=>patch({maxWidth:+e.target.value})}/></Field><Field label="Hauteur max"><input type="number" min="1" value={settings.maxHeight} onChange={e=>patch({maxHeight:+e.target.value})}/></Field>
    <Field label="Rotation"><select value={settings.rotation} onChange={e=>patch({rotation:+e.target.value})}><option value="0">Aucune</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></Field>
    <div className="checks"><label><input type="checkbox" checked={settings.keepRatio} onChange={e=>patch({keepRatio:e.target.checked})}/> Conserver le ratio</label><label><input type="checkbox" checked={settings.flipH} onChange={e=>patch({flipH:e.target.checked})}/> Flip horizontal</label><label><input type="checkbox" checked={settings.flipV} onChange={e=>patch({flipV:e.target.checked})}/> Flip vertical</label></div>
  </div>;
  const audioOnly = kind === 'audio' || settings.operation === 'extract-audio';
  return <div className="form-grid">
    <Field label="Format"><select value={settings.outputFormat} onChange={e=>patch({outputFormat:e.target.value})}>{audioOnly ? <><option value="mp3">MP3</option><option value="wav">WAV</option><option value="aac">AAC</option><option value="m4a">M4A</option><option value="ogg">OGG</option><option value="opus">Opus</option></> : <><option value="mp4">MP4</option><option value="webm">WebM</option></>}</select></Field>
    {!audioOnly && <Field label="Résolution"><select value={settings.resolution} onChange={e=>patch({resolution:e.target.value})}>{['original','2160p','1080p','720p','480p'].map(v=><option key={v}>{v}</option>)}</select></Field>}
    {!audioOnly && <Field label="Qualité"><select value={settings.videoQuality} onChange={e=>patch({videoQuality:e.target.value as Settings['videoQuality']})}><option value="high">Haute qualité</option><option value="balanced">Équilibré</option><option value="small">Petite taille</option></select></Field>}
    <Field label="Bitrate (kb/s)"><input type="number" min="0" value={settings.bitrate} onChange={e=>patch({bitrate:+e.target.value})} placeholder={audioOnly?'192':'0 = auto'}/></Field>
    {!audioOnly && <Field label="Framerate"><input type="number" min="1" max="60" value={settings.framerate} onChange={e=>patch({framerate:+e.target.value})}/></Field>}
    <Field label="Début"><input value={settings.startTime} onChange={e=>patch({startTime:e.target.value})} placeholder="00:00:00"/></Field><Field label="Fin"><input value={settings.endTime} onChange={e=>patch({endTime:e.target.value})} placeholder="00:00:15"/></Field>
    {audioOnly && <Field label="Canaux"><select value={settings.audioChannels} onChange={e=>patch({audioChannels:e.target.value as Settings['audioChannels']})}><option value="keep">Original</option><option value="mono">Mono</option><option value="stereo">Stéréo</option></select></Field>}
    {!audioOnly && <label className="check-row"><input type="checkbox" checked={settings.removeAudio} onChange={e=>patch({removeAudio:e.target.checked})}/> Supprimer l’audio</label>}
    <p className="helper full">Le moteur vidéo (~30 Mo) sera chargé une seule fois, au lancement du premier traitement.</p>
  </div>;
}

function Field({label,children}:{label:string;children:React.ReactNode}) { return <label className="field"><span>{label}</span>{children}</label>; }
function operationLabel(value:string) { return Object.values(operations).flat().find(([key])=>key===value)?.[1] || value; }
function kindIcon(kind:FileKind) { if(kind==='image')return <FileImage size={19}/>; if(kind==='video')return <FileVideo size={19}/>; if(kind==='audio')return <FileAudio size={19}/>; if(kind==='pdf')return <FileText size={19}/>; return <Archive size={19}/>; }
