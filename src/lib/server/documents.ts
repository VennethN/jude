import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CaseDocument, Passage } from '../domain';
import { changeIn, idempotent, readWorkspace } from './cases';
import { checkQuota } from './billing';
import { transaction, type Database } from './db';
import { ApiError, bilingual, invalid, missing, string } from './validation';
import { getOriginal, putOriginal, removeOriginal } from './providers/storage';

const run = promisify(execFile);
const maxBytes = 25 * 1024 * 1024;
const mimeTypes = {
  PDF: 'application/pdf',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  TXT: 'text/plain',
  MD: 'text/markdown',
} as const;
export interface TextPage {
  page: number;
  text: string;
  ocr?: boolean;
}
interface Reading {
  pages: TextPage[];
  viewer?: Uint8Array;
  partial?: boolean;
}
interface FileInfo {
  case_id: string;
  entity_id: string;
  object_key: string;
  byte_length: number | string;
  file_name: string;
  mime: string;
  kind: string;
}
let jobs = 0;

async function pdfPages(data: Uint8Array, folder: string, filePath: string): Promise<Reading> {
  let pages: TextPage[] = [];
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const job = getDocument({ data: Uint8Array.from(data), useSystemFonts: true });
    const pdf = await job.promise;
    try {
      if (pdf.numPages > 350)
        throw new ApiError(413, 'file_too_large', 'A document may contain up to 350 pages.');
      for (let page = 1; page <= pdf.numPages; page++) {
        const p = await pdf.getPage(page),
          content = await p.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
          .join('');
        pages.push({ page, text });
        p.cleanup();
      }
    } finally {
      await job.destroy();
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    try {
      const result = await run('pdftotext', ['-layout', '-enc', 'UTF-8', filePath, '-'], {
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
      });
      const split = result.stdout.split('\f');
      if (!split.at(-1)?.trim()) split.pop();
      pages = split.map((text, i) => ({ page: i + 1, text }));
      if (pages.length > 350)
        throw new ApiError(413, 'file_too_large', 'A document may contain up to 350 pages.');
    } catch (fallbackError) {
      if (fallbackError instanceof ApiError) throw fallbackError;
      return { pages: [], partial: true };
    }
  }
  let scanned = 0,
    partial = false;
  for (const p of pages.filter((p) => p.text.trim().length < 12)) {
    if (++scanned > 12) {
      partial = true;
      continue;
    }
    try {
      const base = join(folder, 'page-' + p.page);
      await run(
        'pdftoppm',
        [
          '-f',
          String(p.page),
          '-l',
          String(p.page),
          '-r',
          '150',
          '-singlefile',
          '-scale-to',
          '2400',
          '-png',
          filePath,
          base,
        ],
        { timeout: 12000, maxBuffer: 65536 },
      );
      const ocr = await run(
        'tesseract',
        [base + '.png', 'stdout', '-l', process.env.JUDE_OCR_LANGUAGES || 'ind+eng'],
        { timeout: 20000, maxBuffer: 1024 * 1024 },
      );
      if (ocr.stdout.trim()) {
        p.text = ocr.stdout;
        p.ocr = true;
      } else partial = true;
    } catch {
      partial = true;
    }
  }
  return { pages, partial };
}
function docxText(bytes: Uint8Array) {
  return import('fflate').then(({ unzipSync, strFromU8 }) => {
    const xml = unzipSync(bytes, {
      filter: (entry) => entry.name === 'word/document.xml' && entry.originalSize <= 12 * 1024 * 1024,
    })['word/document.xml'];
    if (!xml) invalid('file');
    return strFromU8(xml)
      .replace(/<\/w:p>/g, '\n\n')
      .replace(/<w:tab\s*\/>/g, '\t')
      .replace(/<[^>]*>/g, '')
      .replace(
        /&(lt|gt|amp|quot|apos);/g,
        (_, v: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[v] ?? '',
      );
  });
}
export async function readDocument(bytes: Uint8Array, type: CaseDocument['file']): Promise<Reading> {
  if (type === 'TXT' || type === 'MD') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\u0000')) invalid('file');
    return { pages: [{ page: 1, text }] };
  }
  if (jobs >= 2) throw new ApiError(503, 'ingestion_busy', 'Document ingestion is busy. Try again shortly.');
  const folder = await mkdtemp(join(tmpdir(), 'jude-ingest-'));
  jobs++;
  try {
    const path = join(folder, 'original.' + type.toLowerCase());
    await writeFile(path, bytes, { mode: 0o600 });
    if (type === 'PDF') {
      if (Buffer.from(bytes.subarray(0, 1024)).indexOf('%PDF-') < 0) invalid('file');
      return await pdfPages(bytes, folder, path);
    }
    const text = await docxText(bytes);
    try {
      await run(
        process.env.JUDE_SOFFICE || 'soffice',
        [
          '-env:UserInstallation=' + pathToFileURL(join(folder, 'profile')).href,
          '--headless',
          '--convert-to',
          'pdf',
          '--outdir',
          folder,
          path,
        ],
        { timeout: 30000, maxBuffer: 65536 },
      );
      const viewPath = join(folder, 'original.pdf'),
        viewer = await readFile(viewPath);
      const result = await pdfPages(viewer, folder, viewPath);
      if (result.pages.some((p) => p.text.trim())) return { ...result, viewer };
      return { pages: [{ page: 1, text }], viewer };
    } catch {
      return { pages: [{ page: 1, text }] };
    }
  } finally {
    jobs--;
    await rm(folder, { recursive: true, force: true });
  }
}
function passageList(docId: string, pages: TextPage[]) {
  const passages: Passage[] = [];
  let total = 0;
  for (const page of pages) {
    const paragraphs = page.text.replace(/\r/g, '').split(/\n\s*\n/);
    for (const raw of paragraphs) {
      const paragraph = raw.replace(/[\t ]+/g, ' ').trim();
      if (!paragraph) continue;
      total += paragraph.length;
      if (total > 3_000_000)
        throw new ApiError(413, 'file_too_large', 'Document text exceeds the indexing limit.');
      for (let pos = 0; pos < paragraph.length; ) {
        let end = Math.min(pos + 1200, paragraph.length);
        if (end < paragraph.length) {
          const word = paragraph.lastIndexOf(' ', end);
          if (word > pos + 700) end = word;
        }
        const text = paragraph.slice(pos, end).trim();
        passages.push({ id: randomUUID(), docId, page: page.page, text, ocr: page.ocr });
        pos = end;
      }
    }
  }
  passages.forEach((p, i) => {
    if (passages[i - 1]?.page === p.page) p.before = passages[i - 1].text;
    if (passages[i + 1]?.page === p.page) p.after = passages[i + 1].text;
  });
  return passages;
}

export async function storeFile(db: Database, info: FileInfo) {
  await db.query(
    'INSERT INTO attachments(case_id,entity_id,kind,object_key,file_name,mime,byte_length) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [
      info.case_id,
      info.entity_id,
      info.kind,
      info.object_key,
      info.file_name,
      info.mime,
      Number(info.byte_length),
    ],
  );
}
export async function uploadDocument(org: string, caseId: string, form: FormData, key: string | null) {
  const file = form.get('file');
  if (!(file instanceof File) || !file.size || file.size > maxBytes) invalid('file');
  const fileName = basename(file.name)
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 180);
  const type = extname(fileName).slice(1).toUpperCase() as CaseDocument['file'];
  if (!Object.hasOwn(mimeTypes, type)) invalid('file');
  const title = string(form.get('title') || fileName, 'title', 240),
    id = randomUUID();
  const kind = bilingual(form.get('kind') || { id: 'Berkas perkara', en: 'Case document' }, 'kind');
  const scope = caseId + '/documents';
  await readWorkspace(org, caseId);
  const cached = key
    ? await transaction(
        async (db) =>
          (
            await db.query<{ result: string }>(
              'SELECT result FROM idempotency WHERE org_id=$1 AND scope=$2 AND key=$3',
              [org, scope, key],
            )
          )[0],
      )
    : null;
  if (cached) return JSON.parse(cached.result) as CaseDocument;
  await transaction((db) => checkQuota(db, org, 'storage', file.size / 1e9));
  const bytes = new Uint8Array(await file.arrayBuffer());
  let read: Reading;
  try {
    read = await readDocument(bytes, type);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    invalid('file');
  }
  const attachments: FileInfo[] = [
    {
      case_id: caseId,
      entity_id: id,
      kind: 'original',
      object_key: org + '/' + caseId + '/' + id + '/original',
      file_name: fileName,
      mime: mimeTypes[type],
      byte_length: bytes.byteLength,
    },
  ];
  const passages = passageList(id, read.pages),
    base = '/api/cases/' + caseId + '/documents/' + id;
  const doc: CaseDocument = {
    id,
    caseId,
    title,
    kind,
    file: type,
    size: Math.max(1, Math.ceil(file.size / 1024)) + ' KB',
    added: new Date().toISOString().slice(0, 10),
    pages: Math.max(1, read.pages.length),
    pdf: type === 'PDF' ? base + '/original' : read.viewer ? base + '/viewer' : undefined,
    original: base + '/original',
    status: passages.length ? 'ready' : 'text_unavailable',
    scanned: read.pages.some((p) => p.ocr),
    bytes: file.size,
  };
  if (read.viewer)
    attachments.push({
      ...attachments[0],
      kind: 'viewer',
      object_key: org + '/' + caseId + '/' + id + '/viewer',
      file_name: id + '.pdf',
      mime: mimeTypes.PDF,
      byte_length: read.viewer.byteLength,
    });
  let retained = false;
  try {
    await putOriginal(attachments[0].object_key, bytes, mimeTypes[type]);
    if (read.viewer) await putOriginal(attachments[1].object_key, read.viewer, mimeTypes.PDF);
    const saved = await transaction((db) =>
      idempotent(db, org, scope, key, async () => {
        await checkQuota(
          db,
          org,
          'storage',
          attachments.reduce((sum, a) => sum + Number(a.byte_length), 0) / 1e9,
        );
        await changeIn(db, org, caseId, (w) => {
          w.documents.push(doc);
          w.passages.push(...passages);
        });
        for (const a of attachments) await storeFile(db, a);
        return doc;
      }),
    );
    retained = saved.id === id;
    return saved;
  } finally {
    if (!retained) await Promise.allSettled(attachments.map((a) => removeOriginal(a.object_key)));
  }
}

export async function original(org: string, caseId: string, id: string, kind: string) {
  const workspace = await readWorkspace(org, caseId),
    doc = workspace.documents.find((d) => d.id === id);
  if (!doc) missing();
  const [row] = await transaction((db) =>
    db.query<FileInfo>(
      'SELECT object_key,file_name,mime,byte_length FROM attachments WHERE case_id=$1 AND entity_id=$2 AND kind=$3',
      [caseId, id, kind],
    ),
  );
  if (!row) {
    if (workspace.caseRecord.label === 'synthetic' && doc.pdf?.startsWith('/demo/documents/')) {
      const word = kind === 'original' && doc.file === 'DOCX';
      const asset = word ? basename(doc.pdf, '.pdf') + '.docx' : basename(doc.pdf);
      const data = await readFile(join(process.env.JUDE_DEMO_ASSETS_DIR ?? 'static/demo/documents', asset));
      return new Response(data, {
        headers: {
          'Content-Type': word ? mimeTypes.DOCX : mimeTypes.PDF,
          'Content-Disposition': word ? 'attachment; filename="d4.docx"' : 'inline',
          'Cache-Control': 'private, no-store',
        },
      });
    }
    missing();
  }
  const bytes = await getOriginal(row.object_key);
  const pdf = row.mime === 'application/pdf';
  return new Response(new Uint8Array(bytes), {
    headers: {
      'Content-Type': row.mime,
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition':
        (pdf ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(row.file_name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
