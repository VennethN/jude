import { demoAssetsDirectory } from './workspace-paths';
import {
  includeAudio,
  restoreAudio,
  insertArchivedTurns,
  type ArchivedAttachment as Attachment,
} from './archive-audio';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { CaseDocument, Workspace } from '../domain';
import { billing, checkQuota } from './billing';
import { emptyWorkspace, insertWorkspace, makeCase, readWorkspace } from './cases';
import { type Database, transaction } from './db';
import { storeFile } from './documents';
import { contextsOf, hasCitation, relations, updateBoard } from './evidence';
import {
  ApiError,
  bilingual,
  bool,
  choice,
  date,
  invalid,
  number,
  object,
  string,
  type Fields,
} from './validation';
import { getOriginal, putOriginal, removeOriginal } from './providers/storage';

const limits = { zip: 48 * 1024 * 1024, expanded: 96 * 1024 * 1024, entries: 6000 };
const jsonBytes = (value: unknown) => strToU8(JSON.stringify(value));
const collections = [
  'hearings',
  'speakers',
  'statements',
  'findings',
  'documents',
  'passages',
  'connections',
  'boards',
  'threads',
  'legal',
  'replies',
] as const;
type Collection = (typeof collections)[number];
const mimes = {
  PDF: 'application/pdf',
  TXT: 'text/plain',
  MD: 'text/markdown',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
function filePath(doc: CaseDocument, kind: string) {
  return (
    'documents/' + doc.id + '/' + (kind === 'viewer' ? 'viewer.pdf' : 'original.' + doc.file.toLowerCase())
  );
}
async function canExport(db: Database, org: string) {
  const { planId } = await billing(db, org);
  if (planId === 'basic')
    throw new ApiError(402, 'feature_not_in_plan', 'Export requires an eligible plan.', {
      feature: 'jude_export',
    });
}
export async function exportArchive(org: string, caseId: string) {
  await transaction((db) => canExport(db, org));
  const w = await readWorkspace(org, caseId);
  const objects = await transaction((db) =>
    db.query<Attachment>(
      'SELECT entity_id,kind,object_key,file_name,mime,byte_length FROM attachments WHERE case_id=$1',
      [caseId],
    ),
  );
  const files: Record<string, Uint8Array> = {};
  files['manifest.json'] = jsonBytes({
    format: 'jude',
    version: 1,
    caseId,
    title: w.caseRecord.title,
    exportedAt: new Date().toISOString(),
  });
  files['case.json'] = jsonBytes(w);
  files['legal.json'] = jsonBytes(w.legal);
  let size = files['case.json'].length;
  for (const d of w.documents) {
    const owned = objects.filter((v) => v.entity_id === d.id);
    for (const a of owned) {
      size += Number(a.byte_length);
      if (size > limits.expanded)
        throw new ApiError(413, 'file_too_large', 'The case is too large for one archive.');
      files[filePath(d, a.kind)] = await getOriginal(a.object_key);
    }
    if (
      !owned.length &&
      w.caseRecord.label === 'synthetic' &&
      d.pdf &&
      /^\/demo\/documents\/d[1-7]\.pdf$/.test(d.pdf)
    ) {
      const bytes = await readFile(join(demoAssetsDirectory(), basename(d.pdf)));
      files[d.file === 'PDF' ? filePath(d, 'original') : filePath(d, 'viewer')] = bytes;
      size += bytes.byteLength;
      if (d.file === 'DOCX') {
        const word = await readFile(join(demoAssetsDirectory(), basename(d.pdf, '.pdf') + '.docx'));
        files[filePath(d, 'original')] = word;
        size += word.byteLength;
      }
    }
  }
  await includeAudio(files, w, objects, limits.expanded - size);
  const zip = zipSync(files, { level: 1 });
  if (zip.length > limits.zip || Object.keys(files).length > limits.entries)
    throw new ApiError(413, 'file_too_large', 'The case exceeds the archive size limit.');
  return new Response(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/vnd.jude.case+zip',
      'Content-Disposition': 'attachment; filename="case-' + caseId + '.jude"',
      'Cache-Control': 'private, no-store',
    },
  });
}

function archiveId(value: unknown, field = 'id') {
  const id = string(value, field, 120);
  if (!/^[a-zA-Z0-9][\w-]*$/.test(id) || ['constructor', 'prototype', '__proto__'].includes(id))
    invalid(field);
  return id;
}
function list(value: unknown, field: string, max = 12000): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid(field);
  return value;
}
function rowText(value: unknown, key: string, max = 4000) {
  return string(value, key, max, true);
}
function parseWorkspace(raw: unknown) {
  const data = object(raw),
    record = object(data.caseRecord);
  const w = emptyWorkspace(makeCase(record));
  const maps = new Map<string, string>();
  const ref = (v: unknown): string => {
    const id = archiveId(v);
    return maps.get(id) ?? invalid('reference');
  };
  const optionalRef = (v: unknown) => (v ? ref(v) : undefined);
  const assignId = (v: unknown) => {
    const id = archiveId(v);
    if (maps.has(id)) invalid('id');
    maps.set(id, randomUUID());
  };
  maps.set(archiveId(record.id), w.caseRecord.id);
  const rows = (kind: Collection) => list(data[kind] ?? [], kind).map((v) => object(v, kind));
  for (const kind of collections) for (const row of rows(kind)) assignId(row.id);
  // Names and quoted text are preserved verbatim. Only typed references are rewritten.
  w.speakers = rows('speakers').map((r) => ({
    id: ref(r.id),
    label: rowText(r.label, 'label', 180),
    role: choice(
      r.role,
      ['judge', 'judge_member', 'counsel', 'opposing', 'witness', 'party', 'unknown'],
      'role',
    ),
    confirmed: bool(r.confirmed, 'confirmed'),
    alias: optionalRef(r.alias),
  }));
  w.hearings = rows('hearings').map((r) => ({
    id: ref(r.id),
    caseId: w.caseRecord.id,
    number: number(r.number, 'number', 1, 100000),
    title: bilingual(r.title, 'title'),
    date: date(r.date),
    mode: r.mode === 'live' ? 'recorded' : choice(r.mode, ['scheduled', 'imported', 'recorded'], 'mode'),
    time: rowText(r.time, 'time', 10),
    duration: r.duration === undefined ? undefined : number(r.duration, 'duration', 0, 7 * 86400),
  }));
  w.documents = rows('documents').map((r) => ({
    id: ref(r.id),
    caseId: w.caseRecord.id,
    title: string(r.title, 'title', 400),
    kind: bilingual(r.kind, 'kind'),
    pages: number(r.pages, 'pages', 1, 10000),
    file: choice(r.file, ['PDF', 'DOCX', 'TXT', 'MD'], 'file'),
    size: rowText(r.size, 'size', 40),
    added: date(String(r.added).slice(0, 10)),
    scanned: !!r.scanned,
  }));
  const ids = (v: unknown) => (v === undefined ? undefined : list(v, 'refs', 100).map(ref));
  w.legal = rows('legal').map((r) => ({
    id: ref(r.id),
    type: rowText(r.type, 'type', 80),
    regulation: string(r.regulation, 'regulation', 700),
    article: rowText(r.article, 'article', 180),
    summary: bilingual(r.summary, 'summary', 5000),
    keywords: list(r.keywords ?? [], 'keywords', 100).map((v) => string(v, 'keyword', 120)),
  }));
  w.passages = rows('passages').map((r) => ({
    id: ref(r.id),
    docId: ref(r.docId),
    page: number(r.page, 'page', 1, 10000),
    text: string(r.text, 'text', 40000),
    before: rowText(r.before, 'before', 40000),
    after: rowText(r.after, 'after', 40000),
    ocr: !!r.ocr,
  }));
  w.statements = rows('statements').map((r) => ({
    id: ref(r.id),
    hearingId: ref(r.hearingId),
    speakerId: ref(r.speakerId),
    t: number(r.t, 'time', 0, 7 * 86400),
    text: string(r.text, 'text', 40000),
    flagged: !!r.flagged,
    note: rowText(r.note, 'note', 12000),
    phase: 'saved',
    legal: ids(r.legal),
  }));
  w.findings = rows('findings').map((r) => ({
    id: ref(r.id),
    hearingId: ref(r.hearingId),
    statementId: ref(r.statementId),
    status: choice(
      r.status,
      ['supported', 'potential_inconsistency', 'context_needed', 'insufficient_evidence'],
      'status',
    ),
    title: bilingual(r.title, 'title'),
    explanation: bilingual(r.explanation, 'explanation', 12000),
    verify: bilingual(r.verify, 'verify', 12000),
    uncertainty: r.uncertainty ? bilingual(r.uncertainty, 'uncertainty', 12000) : undefined,
    question: rowText(r.question, 'question'),
    said: rowText(r.said, 'said'),
    reviewed: !!r.reviewed,
    note: rowText(r.note, 'note', 12000),
    isNew: false,
    legal: ids(r.legal),
    sources: list(r.sources, 'sources', 50).map((source) => {
      const s = object(source);
      return {
        passageId: ref(s.passageId),
        relation: choice(s.relation, relations, 'relation'),
        match: rowText(s.match, 'match'),
      };
    }),
  }));
  const node = (raw: unknown) => {
    const n = object(raw);
    return { kind: choice(n.kind, ['statement', 'passage'], 'kind'), id: ref(n.id) };
  };
  w.connections = rows('connections').map((r) => ({
    id: ref(r.id),
    from: node(r.from),
    to: node(r.to),
    relation: choice(r.relation, relations, 'relation'),
    reviewed: !!r.reviewed,
    basis: choice(r.basis, ['ai', 'semantic', 'keywords', 'manual'], 'basis'),
    why: bilingual(r.why, 'why', 4000, true),
  }));
  for (const p of w.passages)
    if (!w.documents.some((d) => d.id === p.docId && d.pages >= p.page)) invalid('passages');
  for (const s of w.statements)
    if (!w.hearings.some((h) => h.id === s.hearingId) || !w.speakers.some((v) => v.id === s.speakerId))
      invalid('statements');
  for (const f of w.findings)
    if (
      !w.statements.some((s) => s.id === f.statementId && s.hearingId === f.hearingId) ||
      f.sources.some((s) => !w.passages.some((p) => p.id === s.passageId))
    )
      invalid('findings');
  for (const c of w.connections)
    if (
      ![c.from, c.to].every((n) =>
        w[n.kind === 'statement' ? 'statements' : 'passages'].some((v) => v.id === n.id),
      )
    )
      invalid('connections');
  for (const b of rows('boards')) {
    const id = ref(b.id),
      excerpts: Record<string, unknown> = {};
    const boardKey = (v: unknown) => {
      const [kind, source] = string(v, 'key', 250).split(':');
      return kind + ':' + ref(source);
    };
    for (const [old, raw] of Object.entries(object(b.excerpts ?? {}))) {
      assignId(old);
      const ex = object(raw);
      excerpts[ref(old)] = { ...ex, docId: ref(ex.docId), passageId: optionalRef(ex.passageId) };
    }
    w.boards.push({
      id,
      name: string(b.name, 'name', 100),
      cards: [],
      links: [],
      excerpts: {},
      dismissed: [],
      suggest: true,
      version: 0,
      updated: Date.now(),
    });
    const cards = list(b.cards, 'cards', 500).map((raw) => {
      const c = object(raw);
      return { ...c, id: ref(c.id), key: boardKey(c.key) };
    });
    const links = list(b.links, 'links', 1500).map((raw) => {
      const l = object(raw);
      return {
        ...l,
        id: randomUUID(),
        from: boardKey(l.from),
        to: boardKey(l.to),
        findingId: optionalRef(l.findingId),
        connectionId: optionalRef(l.connectionId),
      };
    });
    const dismissed = list(b.dismissed ?? [], 'dismissed', 1000).map((v) =>
      string(v, 'dismissed', 300).split('|').map(boardKey).join('|'),
    );
    updateBoard(w, id, { version: 0, suggest: !!b.suggest, cards, links, excerpts, dismissed });
  }
  w.threads = rows('threads').map((r) => {
    const title = typeof r.title === 'string' ? rowText(r.title, 'title', 240) : bilingual(r.title, 'title');
    return {
      id: ref(r.id),
      caseId: w.caseRecord.id,
      title,
      updated: number(r.updated, 'updated', 0, Number.MAX_SAFE_INTEGER),
      sample: !!r.sample,
      messages: list(r.messages, 'messages', 2000).map((raw) => {
        const m = object(raw),
          text =
            typeof m.text === 'string' ? string(m.text, 'text', 40000) : bilingual(m.text, 'text', 40000);
        const citations = list(m.citations ?? [], 'citations', 60).map((raw) => {
          const c = object(raw);
          return {
            kind: choice(c.kind, ['statement', 'passage', 'finding', 'document', 'hearing'], 'kind'),
            id: ref(c.id),
          };
        });
        if (citations.some((c) => !hasCitation(w, c))) invalid('citations');
        const contexts = contextsOf(
          w,
          list(m.contexts ?? [], 'contexts', 12).map((raw) => {
            const c = object(raw);
            return { ...c, id: optionalRef(c.id) };
          }),
        );
        return {
          id: randomUUID(),
          role: choice(m.role, ['user', 'assistant'], 'role'),
          text,
          citations,
          contexts,
          legal: ids(m.legal),
          mode: m.mode ? choice(m.mode, ['ai', 'sources-only'], 'mode') : undefined,
        };
      }),
    };
  });
  w.replies = rows('replies').map((r) => {
    return {
      id: ref(r.id),
      hearingId: ref(r.hearingId),
      statementId: ref(r.statementId),
      forId: ref(r.forId),
      reason: choice(r.reason, ['called', 'objection', 'answer'], 'reason'),
      suggestions: list(r.suggestions, 'suggestions', 5).map((raw) => {
        const s = object(raw),
          b = object(s.basis);
        const basis =
          b.kind === 'procedure'
            ? { kind: 'procedure' as const }
            : { kind: choice(b.kind, ['finding', 'passage'], 'kind'), id: ref(b.id) };
        return {
          text: string(s.text, 'text', 12000),
          why: bilingual(s.why, 'why', 4000),
          confidence: number(s.confidence, 'confidence', 0, 1),
          basis,
        };
      }),
    };
  });
  return { w, maps, original: rows('documents') };
}

export async function importArchive(org: string, form: FormData, creator?: string) {
  const file = form.get('file');
  if (!(file instanceof File) || file.size > limits.zip || !file.size) invalid('file');
  await transaction((db) => checkQuota(db, org, 'cases', 1));
  let files: Record<string, Uint8Array>, decoded: ReturnType<typeof parseWorkspace>;
  try {
    let count = 0,
      total = 0;
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (entry) => {
        if (++count > limits.entries || (total += entry.originalSize) > limits.expanded)
          throw new ApiError(413, 'file_too_large', 'The archive exceeds the import limit.');
        return (
          entry.name === 'case.json' ||
          entry.name === 'manifest.json' ||
          entry.name === 'audio/index.json' ||
          /^audio\/[\w-]+\/(recording\.(mp3|wav|m4a|mp4|mpeg|mpga|webm|ogg|flac)|[\w-]+\.pcm)$/.test(
            entry.name,
          ) ||
          /^documents\/[\w-]+\/(original\.(pdf|docx|md|txt)|viewer\.pdf)$/.test(entry.name)
        );
      },
    });
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    if (manifest.format !== 'jude' || manifest.version !== 1) invalid('manifest');
    decoded = parseWorkspace(JSON.parse(strFromU8(files['case.json'])));
  } catch (e) {
    if (e instanceof ApiError) throw e;
    invalid('file');
  }
  const { w, maps, original } = decoded;
  const attachments: Attachment[] = [];
  const pending = new Set<string>();
  let committed = false;
  try {
    for (const src of original) {
      const old = archiveId(src.id),
        doc = w.documents.find((d) => d.id === maps.get(old))!;
      const base = '/api/cases/' + w.caseRecord.id + '/documents/' + doc.id;
      for (const kind of ['original', 'viewer']) {
        const name = kind === 'viewer' ? 'viewer.pdf' : 'original.' + doc.file.toLowerCase();
        const bytes = files['documents/' + old + '/' + name];
        if (!bytes?.length) continue;
        const mime = kind === 'viewer' ? mimes.PDF : mimes[doc.file];
        const object_key = org + '/' + w.caseRecord.id + '/' + doc.id + '/' + kind;
        attachments.push({
          entity_id: doc.id,
          kind,
          object_key,
          file_name: name,
          mime,
          byte_length: bytes.length,
        });
        pending.add(object_key);
        await putOriginal(object_key, bytes, mime);
        if (kind === 'original') doc.original = base + '/original';
        if (kind === 'viewer' || doc.file === 'PDF') doc.pdf = base + '/' + kind;
      }
      doc.status = w.passages.some((p) => p.docId === doc.id) ? 'ready' : 'text_unavailable';
    }
    const turns = await restoreAudio(files, w, maps, org, attachments, pending);
    const audioBytes = turns.reduce((total, t) => total + (t.object_key ? t.bytes : 0), 0);
    await transaction(async (db) => {
      await checkQuota(db, org, 'cases', 1);
      await checkQuota(db, org, 'boards', w.boards.length);
      await checkQuota(
        db,
        org,
        'storage',
        attachments
          .filter((a) => a.kind !== 'viewer')
          .reduce((sum, a) => sum + Number(a.byte_length), audioBytes) / 1e9,
      );
      await insertWorkspace(db, org, w, creator);
      for (const a of attachments) await storeFile(db, { ...a, case_id: w.caseRecord.id });
      await insertArchivedTurns(db, w.caseRecord.id, turns);
    });
    committed = true;
    return w.caseRecord;
  } finally {
    if (!committed) await Promise.allSettled([...pending].map(removeOriginal));
  }
}
