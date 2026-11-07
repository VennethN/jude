import { createHash } from 'node:crypto';
import type { Citation, ContextRef, LegalRef, Workspace } from '../../domain';
import { pasalSourceUrl } from '../../legal';
import { transaction } from '../db';
import { legal as samples } from '../seed';

const origin = 'https://pasal.id';
const ttl = 30 * 24 * 60 * 60 * 1000;
const maxBytes = 1024 * 1024;
const maxItems = 256;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const identifier = (uri: string, article: string) => 'pasal-' + digest(uri + '\n' + article).slice(0, 32);
const token = () => process.env.JUDE_PASAL_TOKEN?.trim();
let interrupted: { fingerprint: string; until: number } | undefined;

type Json = Record<string, unknown>;
const record = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
const field = (value: unknown, limit = 250) =>
  typeof value === 'string' && value.trim().length <= limit ? value.trim() : '';

interface Work {
  uri: string;
  type: string;
  title: string;
  number: string;
  year: string;
  status: string;
}
interface Hit {
  work: Work;
  article: string;
  url?: string;
}
interface Search {
  q: string;
  article: string;
  numbered?: { type: string; number: string; year: string };
  code?: string;
}

export function legalDiscoveryMode(
  w: Pick<Workspace, 'caseRecord'>,
): NonNullable<Workspace['legalDiscovery']> {
  if (w.caseRecord.label === 'synthetic') return 'sample';
  const key = token();
  if (!key || (interrupted?.fingerprint === digest(key) && interrupted.until > Date.now()))
    return 'unavailable';
  return 'available';
}

const vocabulary: [RegExp, string][] = [
  [/\b(?:penggelapan|embezzlement)\b/i, 'penggelapan'],
  [/\b(?:alat bukti|admissibility|evidence law)\b/i, 'alat bukti'],
  [/\b(?:keterangan saksi|witness testimony|testimony of witnesses)\b/i, 'keterangan saksi'],
  [/\b(?:perekaman sidang|rekaman sidang|courtroom recording)\b/i, 'perekaman sidang'],
  [/\b(?:ketenagakerjaan|employment law)\b/i, 'ketenagakerjaan'],
];

/** Only reconstructed public identifiers and fixed legal vocabulary may leave the case boundary. */
function searchTerms(input: string, explicitOnly = false): Search | undefined {
  const article = input.match(/\b(?:pasal|article)\s+(\d{1,4}[a-z]?)\b/i)?.[1]?.toUpperCase() ?? '';
  const numbered = input.match(
    /\b(UU|PP|PERPPU|PERPRES|PERMA|PERDA|undang[- ]undang)\s*(?:RI\s*)?(?:(?:no\.?|nomor)\s*)?(\d{1,4})\s*(?:tahun\s*|\/\s*|of\s+)((?:19|20)\d{2})\b/i,
  );
  const code = input.match(/\b(?:KUHAP|KUHP|KUHPerdata|KUHD)\b/i)?.[0]?.toUpperCase();
  const law = numbered
    ? {
        type: numbered[1].toLowerCase().startsWith('undang') ? 'UU' : numbered[1].toUpperCase(),
        number: numbered[2],
        year: numbered[3],
      }
    : undefined;
  const regulation = law ? `${law.type} Nomor ${law.number} Tahun ${law.year}` : code;
  const name =
    regulation ?? (article || explicitOnly ? '' : vocabulary.find(([pattern]) => pattern.test(input))?.[1]);
  const q = [article ? 'Pasal ' + article : '', name].filter(Boolean).join(' ');
  return q ? { q, article, numbered: law, code } : undefined;
}

function validUri(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 320 &&
    /^\/akn\/id\/act\/(?:[a-z0-9-]{1,64}\/){1,6}[a-z0-9-]{1,64}$/i.test(value)
  );
}
function workOf(raw: unknown): Work | undefined {
  const row = record(raw),
    uri = row.frbr_uri,
    title = field(row.title, 500),
    type = field(row.type, 32);
  if (!validUri(uri) || !title || !type) return;
  const year = String(row.year ?? ''),
    number = String(row.number ?? '');
  return {
    uri,
    title,
    type,
    year: /^\d{4}$/.test(year) ? year : '',
    number: /^[\w.-]{1,25}$/.test(number) ? number : '',
    status: row.status_uncertain === true ? '' : field(row.status, 40),
  };
}
function source(raw: unknown) {
  const value = field(raw, 2048);
  if (!value) return;
  try {
    return pasalSourceUrl(new URL(value, origin).href);
  } catch {
    return;
  }
}
function hitOf(raw: unknown, query: Search): Hit | undefined {
  const item = record(raw),
    work = workOf(item.work);
  if (!work) return;
  const law = query.numbered;
  if (law && (work.type.toUpperCase() !== law.type || work.number !== law.number || work.year !== law.year))
    return;
  if (query.code && !law) {
    const names: Record<string, RegExp> = {
      KUHAP: /\bKUHAP\b|hukum acara pidana/i,
      KUHP: /\bKUHP\b|kitab undang[- ]undang hukum pidana/i,
      KUHPERDATA: /\bKUHPerdata\b|hukum perdata/i,
      KUHD: /\bKUHD\b|hukum dagang/i,
    };
    if (!names[query.code]?.test(work.title)) return;
  }
  const passage = record(item.best_passage);
  const proven = passage.version === 1 ? field(passage.pasal_number, 5).toUpperCase() : '';
  const numbers = Array.isArray(item.matching_pasals) ? item.matching_pasals.map(String) : [];
  if (
    query.article &&
    proven !== query.article &&
    !numbers.some((value) => value.toUpperCase() === query.article)
  )
    return;
  const article =
    query.article || (!query.numbered && !query.code && /^\d{1,4}[A-Z]?$/.test(proven) ? proven : '');
  const url =
    (proven && proven === article ? source(passage.href) : undefined) ??
    source(passage.work_href) ??
    source(item.work_href) ??
    source(record(item.work).href);
  return { work, article, url };
}
function metadataRef(hit: Hit): LegalRef {
  const { work, article } = hit;
  const regulation =
    work.number && work.year
      ? `${work.type} No. ${work.number} Tahun ${work.year} · ${work.title}`
      : work.title;
  const label = article ? 'Pasal ' + article : '';
  const summary = work.status
    ? {
        id: `Status yang tercatat dalam indeks Pasal.id adalah “${work.status}”.`,
        en: `Pasal.id lists the regulation’s status as “${work.status}”.`,
      }
    : { id: 'Identitas peraturan tercatat dalam indeks Pasal.id.', en: 'Pasal.id indexes this regulation.' };
  return {
    id: identifier(work.uri, article),
    provider: 'pasal',
    type: work.type,
    regulation,
    article: label,
    summary,
    keywords: [work.type, work.title, label].filter((value) => value.length > 0 && value.length <= 120),
    ...(hit.url ? { sourceUrl: hit.url } : {}),
  };
}

async function readJson(path: string, key: string): Promise<unknown> {
  const response = await fetch(origin + '/api/v1/' + path, {
    headers: { accept: 'application/json', authorization: 'Bearer ' + key },
    redirect: 'error',
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error('pasal_unavailable');
  }
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('pasal_response_limit');
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    reader.releaseLock();
  }
}

async function cached<T>(cacheKey: string, load: () => Promise<T>): Promise<T> {
  const [row] = await transaction((db) =>
    db.query<{ metadata: string }>(
      'SELECT metadata FROM pasal_metadata_cache WHERE cache_key=$1 AND expires_at>$2',
      [cacheKey, Date.now()],
    ),
  );
  if (row) return JSON.parse(row.metadata) as T;
  const data = await load();
  await transaction(async (db) => {
    if (db.forUpdate) await db.query('SELECT pg_advisory_xact_lock(1937446203)');
    const now = Date.now();
    await db.query('DELETE FROM pasal_metadata_cache WHERE expires_at<=$1', [now]);
    await db.query(
      'INSERT INTO pasal_metadata_cache(cache_key,metadata,expires_at) VALUES($1,$2,$3) ON CONFLICT(cache_key) DO UPDATE SET metadata=excluded.metadata,expires_at=excluded.expires_at',
      [cacheKey, JSON.stringify(data), now + ttl],
    );
    await db.query(
      'DELETE FROM pasal_metadata_cache WHERE cache_key NOT IN (SELECT cache_key FROM pasal_metadata_cache ORDER BY expires_at DESC,cache_key ASC LIMIT $1)',
      [maxItems],
    );
  });
  return data;
}

/** The detail response can contain an article tree. Only the public work identity is retained. */
export async function getPasalWork(uri: string, key: string) {
  if (!validUri(uri)) return undefined;
  const work = await cached('work:' + digest(uri), async () => {
    const result = record(await readJson('laws' + uri, key));
    const found = workOf(result.work);
    return found?.uri === uri ? found : null;
  });
  return work ?? undefined;
}

async function searchPasal(query: Search, key: string): Promise<LegalRef[]> {
  const hits = await cached('search:' + digest(query.q), async () => {
    const result = record(await readJson('search?' + new URLSearchParams({ q: query.q, limit: '3' }), key));
    if (!Array.isArray(result.results)) throw new Error('invalid_pasal_results');
    const seen = new Set<string>();
    return result.results.slice(0, 3).flatMap((item) => {
      const hit = hitOf(item, query);
      if (!hit || seen.has(hit.work.uri + '#' + hit.article)) return [];
      seen.add(hit.work.uri + '#' + hit.article);
      return [hit];
    });
  });
  const primary = hits[0];
  if (!primary) return [];
  // Search already supplies a usable identity. Detail can verify the status without retaining its content.
  let verified: Work | undefined;
  try {
    verified = await getPasalWork(primary.work.uri, key);
  } catch {
    /* Keep the search result's own metadata. */
  }
  return hits.map((hit, index) => metadataRef(index === 0 && verified ? { ...hit, work: verified } : hit));
}

function contextLaws(w: Workspace, refs: (Citation | ContextRef)[]) {
  const ids = new Set<string>(),
    statements = new Set<string>(),
    passages = new Set<string>();
  for (const ref of refs) {
    if (ref.kind === 'finding') {
      const finding = w.findings.find((f) => f.id === ref.id);
      if (finding) {
        finding.legal?.forEach((id) => ids.add(id));
        statements.add(finding.statementId);
        for (const source of finding.sources) passages.add(source.passageId);
      }
    } else if (ref.kind === 'statement') statements.add(ref.id);
    else if (ref.kind === 'passage') passages.add(ref.id);
  }
  const lines = w.statements.filter((line) => statements.has(line.id));
  for (const line of lines) line.legal?.forEach((id) => ids.add(id));
  const text = [
    ...lines.map((line) => line.text),
    ...w.passages.filter((p) => passages.has(p.id)).map((p) => p.text),
  ];
  return { ids, text };
}

async function privateLookup(w: Workspace, query?: Search): Promise<LegalRef[]> {
  const key = token();
  if (!key || !query || legalDiscoveryMode(w) !== 'available') return [];
  try {
    return await searchPasal(query, key);
  } catch {
    interrupted = { fingerprint: digest(key), until: Date.now() + 60000 };
    return [];
  }
}

/** An automatic finding may look up only the named law within an independently checked quotation. */
export function discoverCitedLegal(w: Workspace, quotations: string[]): Promise<LegalRef[]> {
  const query = quotations
    .map((quote) => searchTerms(quote, true))
    .find((term) => term?.numbered || term?.code);
  return privateLookup(w, query);
}

export async function discoverLegal(
  w: Workspace,
  text: string,
  refs: (Citation | ContextRef)[],
): Promise<LegalRef[]> {
  const related = contextLaws(w, refs),
    query = searchTerms(text);
  if (w.caseRecord.label === 'synthetic') {
    const words = ' ' + (text.toLowerCase().match(/[\p{L}\d]+/gu) ?? []).join(' ') + ' ';
    const rank = samples.map((sample) => {
      const seen = w.legal.find(
        (row) => row.regulation === sample.regulation && row.article === sample.article,
      );
      let score = 0;
      if (
        (!query?.article || sample.article === 'Pasal ' + query.article) &&
        (!query?.code || sample.regulation.toUpperCase().includes(query.code))
      ) {
        score =
          (seen && related.ids.has(seen.id) ? 20 : 0) +
          (query?.article ? 20 : 0) +
          sample.keywords.filter((word) => words.includes(' ' + word.toLowerCase() + ' ')).length;
      }
      return { ref: { ...sample, id: seen?.id ?? sample.id, provider: 'sample' as const }, score };
    });
    return rank
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => item.ref);
  }
  const saved = w.legal.filter((row) => row.provider === 'pasal' && related.ids.has(row.id));
  const safeQuery = query ?? related.text.map((line) => searchTerms(line, true)).find(Boolean);
  return [...saved, ...(await privateLookup(w, safeQuery))].slice(0, 6);
}

export function retainLegal(w: Workspace, discoveries: LegalRef[]) {
  const ids = new Set<string>();
  for (const ref of discoveries) {
    if (ref.provider === 'sample' && w.caseRecord.label !== 'synthetic') continue;
    const same = w.legal.find(
      (row) =>
        (row.provider === ref.provider || (!row.provider && ref.provider === 'sample')) &&
        row.article === ref.article &&
        (row.id === ref.id ||
          (ref.sourceUrl ? row.sourceUrl === ref.sourceUrl : row.regulation === ref.regulation)),
    );
    if (same) ids.add(same.id);
    else if (!w.legal.some((row) => row.id === ref.id)) {
      w.legal.push(ref);
      ids.add(ref.id);
    }
    if (ids.size === 3) break;
  }
  return [...ids];
}
