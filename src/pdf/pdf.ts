import { PDFDocument, degrees } from 'pdf-lib';

export async function mergePdfs(files: File[]) {
  const output = await PDFDocument.create();
  for (const file of files) {
    const source = await PDFDocument.load(await file.arrayBuffer());
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach(page => output.addPage(page));
  }
  return new Blob([await output.save() as BlobPart], { type: 'application/pdf' });
}

export async function editPdf(file: File, pagesText: string, mode: 'extract' | 'remove' | 'rotate') {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const selected = new Set(parsePages(pagesText, source.getPageCount()));
  if (mode === 'rotate') {
    source.getPages().forEach((page, index) => { if (selected.has(index)) page.setRotation(degrees((page.getRotation().angle + 90) % 360)); });
    return new Blob([await source.save() as BlobPart], { type: 'application/pdf' });
  }
  const indices = source.getPageIndices().filter(index => mode === 'extract' ? selected.has(index) : !selected.has(index));
  if (!indices.length) throw new Error('Aucune page ne resterait dans le document.');
  const output = await PDFDocument.create();
  (await output.copyPages(source, indices)).forEach(page => output.addPage(page));
  return new Blob([await output.save() as BlobPart], { type: 'application/pdf' });
}

function parsePages(text: string, count: number) {
  const result = new Set<number>();
  text.split(',').map(s => s.trim()).filter(Boolean).forEach(part => {
    const [from, to] = part.split('-').map(Number);
    if (to) for (let page = from; page <= to; page++) { if (page > 0 && page <= count) result.add(page - 1); }
    else if (from > 0 && from <= count) result.add(from - 1);
  });
  return [...result];
}

export async function imagesToPdf(files: File[]) {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const image = file.type === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    const { width, height } = image.scale(1);
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  return new Blob([await pdf.save() as BlobPart], { type: 'application/pdf' });
}
