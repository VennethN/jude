import { createHash, randomUUID } from 'node:crypto';
import type { CaseDocument, NodeRef, Role, Speaker } from '../domain';
import { relations } from './evidence';
import { ApiError, archiveId, bool, choice, date, invalid, number, object, string, type Fields } from './validation';

const types = new Map<string, CaseDocument['file']>([
  ['application/pdf', 'PDF'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
  ['text/plain', 'TXT'],
  ['text/markdown', 'MD'],
]);
const roles: Role[] = ['judge', 'judge_member', 'counsel', 'opposing', 'witness', 'party', 'unknown'];
const collections = new Set(['case', 'documents', 'sources', 'hearings', 'segments', 'links', 'findings']);

function problem(code: 'archive_integrity' | 'archive_reference' | 'archive_unsupported', field: string, message: string): never {
  throw new ApiError(422, code, message, { fields: [field] });
}

function rows(value: unknown, field: string): Fields[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 12_000) invalid(field);
  return value.map(row => object(row, field));
}

function whole(value: unknown, field: string, max: number) {
  const n = number(value, field, 1, max);
  if (!Number.isInteger(n)) invalid(field);
  return n;
}

function day(value: unknown) {
  return date(string(value, 'date', 60).slice(0, 10));
}

function verbatim(value: unknown, field: string, limit: number, optional = false) {
  string(value, field, limit, optional);
  return typeof value === 'string' ? value : '';
}

/** Translate a document-indexed case manifest into the same validated workspace used by native imports. */
export function workspaceFromManifest(manifest: Fields, files: Record<string, Uint8Array>): Fields {
  if (manifest.format !== 'jude' || manifest.version !== 1 || manifest.kind !== 'case') invalid('manifest');
  for (const [key, value] of Object.entries(manifest)) {
    if (!collections.has(key) && value && typeof value === 'object' && Object.keys(value).length)
      problem('archive_unsupported', 'manifest.collections', 'This manifest contains a record collection Jude cannot import.');
  }
  // This format has no established mapping for a legacy finding's cited exhibits or its review state.
  if (rows(manifest.findings, 'findings').length)
    problem('archive_unsupported', 'manifest.findings', 'This manifest contains findings whose evidence references cannot be imported.');
  const record = object(manifest.case, 'case');
  const caseId = archiveId(record.id, 'case.id');
  const ids = new Set([caseId]);
  const nodes = new Map<string, NodeRef & { text: string }>();
  const originals = new Map<string, Uint8Array>();
  const declared = new Set<string>();
  function unique(row: Fields, field: string) {
    const id = archiveId(row.id, field);
    if (ids.has(id)) invalid(field);
    ids.add(id);
    if (row.case_id !== undefined && row.case_id !== caseId) invalid('case_id');
    return id;
  }

  const documents = rows(manifest.documents, 'documents').map(row => {
    const id = unique(row, 'documents.id'), path = 'originals/' + id;
    if (row.file !== path || !Object.hasOwn(files, path) || !files[path].byteLength)
      problem('archive_integrity', 'documents.original', 'A declared original document is missing or has a different archive path.');
    const bytes = files[path], digest = string(row.sha256, 'documents.sha256', 64);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (!/^[a-f\d]{64}$/i.test(digest) || actual !== digest.toLowerCase())
      problem('archive_integrity', 'documents.sha256', 'An original document does not match its SHA-256 digest.');
    const file = types.get(string(row.mime, 'documents.mime', 150)) ?? invalid('documents.mime');
    const canonical = 'documents/' + id + '/original.' + file.toLowerCase();
    if (Object.hasOwn(files, canonical))
      problem('archive_integrity', 'documents.original', 'An original document has two archive entries.');
    originals.set(canonical, bytes);
    declared.add(path);
    return {
      id, title: string(row.name, 'documents.name', 400), kind: { id: 'Dokumen', en: 'Document' },
      file, pages: whole(row.pages, 'documents.pages', 10_000), size: bytes.byteLength + ' B',
      added: day(row.created_at ?? record.created_at ?? new Date().toISOString()),
    };
  });
  if (Object.keys(files).some(path => path.startsWith('originals/') && !declared.has(path)))
    problem('archive_integrity', 'documents.original', 'The archive contains an original document absent from the index.');
  const docPages = new Map(documents.map(doc => [doc.id, doc.pages]));
  const passages = rows(manifest.sources, 'sources').map(row => {
    const id = unique(row, 'sources.id'), docId = archiveId(row.document_id, 'sources.document_id');
    const pages = docPages.get(docId) ?? problem('archive_reference', 'sources.document_id', 'A passage refers to a missing document.');
    const page = whole(row.page, 'sources.page', pages);
    const text = verbatim(row.text, 'sources.text', 40_000);
    nodes.set(id, { kind: 'passage', id, text });
    return { id, docId, text, page, before: string(row.section, 'sources.section', 4000, true) };
  });

  const hearings = rows(manifest.hearings, 'hearings').map((row, index) => {
    if (row.source_document_id != null)
      problem('archive_unsupported', 'hearings.source_document_id', 'This manifest links a hearing to an original document in an unsupported format.');
    return {
      id: unique(row, 'hearings.id'), number: index + 1, title: row.title, date: day(row.date),
      mode: choice(row.kind, ['scheduled','imported','recorded','live'], 'hearings.kind'),
      duration: undefined as number | undefined,
    };
  });
  const byHearing = new Map(hearings.map(h => [h.id, h]));
  const speakers = new Map<string, Speaker>();
  function speaker(key: string, label: string, role: Role = 'unknown', confirmed = false) {
    const person = { id: randomUUID(), label, role, confirmed };
    speakers.set(key, person);
    ids.add(person.id);
    return person;
  }
  for (const [key, value] of Object.entries(object(record.speakers ?? {}, 'case.speakers'))) {
    if (typeof value === 'string') speaker(key, string(value, 'speakers.label', 180));
    else {
      const row = object(value, 'case.speakers');
      speaker(
        key, string(row.label ?? row.name, 'speakers.label', 180),
        choice(row.role ?? 'unknown', roles, 'speakers.role'), bool(row.confirmed ?? false, 'speakers.confirmed'),
      );
    }
  }
  const statements = rows(manifest.segments, 'segments').map(row => {
    const id = unique(row, 'segments.id'), hearingId = archiveId(row.hearing_id, 'segments.hearing_id');
    const hearing = byHearing.get(hearingId) ?? problem('archive_reference', 'segments.hearing_id', 'A testimony segment refers to a missing hearing.');
    const t = number(row.start, 'segments.start', 0, 604_800);
    const end = number(row.end ?? t, 'segments.end', t, 604_800);
    hearing.duration = Math.max(hearing.duration ?? 0, end);
    const text = verbatim(row.text, 'segments.text', 40_000);
    const key = string(row.speaker, 'segments.speaker', 180);
    const person = speakers.get(key) ?? speaker(key, key);
    nodes.set(id, { kind: 'statement', id, text });
    return { id, hearingId, speakerId: person.id, t, text };
  });
  const connections = rows(manifest.links, 'links').map(row => {
    const id = unique(row, 'links.id');
    function endpoint(side: 'source' | 'target') {
      const field = 'links.' + side + '_id';
      const node = nodes.get(archiveId(row[side + '_id'], field)) ??
        problem('archive_reference', field, 'An evidence link refers to a missing passage or statement.');
      const quote = verbatim(row[side + '_quote'], 'links.' + side + '_quote', 4000, true);
      if (quote && !node.text.includes(quote))
        problem('archive_reference', 'links.' + side + '_quote', 'A quoted link does not match the evidence it cites.');
      return { ref: { kind: node.kind, id: node.id }, quote };
    }
    const from = endpoint('source'), to = endpoint('target');
    // The native connection has one rationale field. Carry the exact paired quotations into it.
    const rationale = verbatim(row.explanation, 'links.explanation', 4000, true);
    const quotations = [from.quote, to.quote].filter(Boolean).map(q => '“' + q + '”');
    const why = [rationale, ...quotations].filter(Boolean).join('\n\n');
    return {
      id, from: from.ref, to: to.ref, relation: choice(row.relation, relations, 'links.relation'),
      basis: choice(row.basis, ['manual','ai','keywords','semantic'], 'links.basis'),
      reviewed: bool(row.confirmed ?? false, 'links.confirmed'), why: string(why, 'links.explanation', 4000, true),
    };
  });
  for (const [path, bytes] of originals) files[path] = bytes;
  return {
    caseRecord: { id: caseId, title: record.title, reference: record.reference, summary: record.description },
    documents, passages, hearings, speakers: [...speakers.values()], statements, connections,
  };
}
