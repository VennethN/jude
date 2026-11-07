import { createHash, randomUUID } from 'node:crypto';
import type { ChatMessage, Citation, ContextRef, Lang, LegalRef, LegalSearchStatus, Workspace } from '../../domain';
import { caseSources, contextKeys, type Source } from './assistant';
import { constitutionalTopic, isLawQuestion, lawCategory, publicLawTerms as searchTerms, type PublicLawSearch as Search } from './legal-query';
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
  url?: string;
}
interface Hit {
  work: Work;
  article: string;
  url?: string;
}
export function legalDiscoveryMode(
  w: { caseRecord: Pick<Workspace['caseRecord'], 'label'> },
): NonNullable<Workspace['legalDiscovery']> {
  if (w.caseRecord.label === 'synthetic') return 'sample';
  const key = token();
  if (!key || (interrupted?.fingerprint === digest(key) && interrupted.until > Date.now()))
    return 'unavailable';
  return 'available';
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
    url: source(row.url) ?? source(row.href),
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
function articleNumber(value: unknown) {
  const token = (typeof value === 'number' ? String(value) : field(value, 20)).replace(/^Pasal\s+/i, '').toUpperCase();
  return /^\d{1,4}[A-Z]?$/.test(token) ? token : '';
}

function hitOf(raw: unknown, query: Search): Hit | undefined {
  const item = record(raw),
    work = workOf(item.work);
  if (!work) return;
  if (item.status_uncertain === true) work.status = '';
  if (query.type && work.type.toUpperCase() !== query.type) return;
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
  const proven = articleNumber(passage.pasal ?? (passage.version === 1 ? passage.pasal_number : undefined));
  const matches = Array.isArray(item.matching_pasals) ? item.matching_pasals : [];
  const match = matches.find(value => {
    const number = typeof value === 'object' ? record(value).pasal ?? record(value).pasal_number : value;
    return articleNumber(number) === query.article;
  });
  if (query.article && proven !== query.article && match === undefined) return;
  const article = query.article ||
    (!query.numbered && !query.code && (query.type !== 'UUD' || query.topic) && /^\d{1,4}[A-Z]?$/.test(proven) ? proven : '');
  const workUrl = source(item.url) ?? source(record(item.work).url) ?? source(passage.work_href) ??
    source(item.work_href) ?? source(record(item.work).href);
  const articleUrl = (article && proven === article ? source(passage.url ?? passage.href) : undefined) ??
    (article && match !== undefined ? source(record(match).url ?? record(match).href) : undefined);
  const locator = articleUrl && new URL(articleUrl);
  const articlePath = locator && locator.pathname.replace(/\/pasal-[^/]+\/?$/, '').replace(/\/$/, '');
  const matchesArticle = locator && new RegExp('(?:/pasal-|#(?:pasal|node)-)' + article + '/?$', 'i').test(locator.href);
  const sameWork = !workUrl || articlePath === new URL(workUrl).pathname.replace(/\/$/, '');
  const url = matchesArticle && sameWork ? articleUrl : workUrl;
  return { work, article, url };
}
function metadataRef(hit: Hit): LegalRef {
  const { work, article } = hit;
  const regulation =
    work.type !== 'UUD' && work.number && work.year
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

async function readJson(path: string, key: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(origin + '/api/v1/' + path, {
    headers: { accept: 'application/json', authorization: 'Bearer ' + key },
    redirect: 'error',
    signal: AbortSignal.any([AbortSignal.timeout(8000), ...(signal ? [signal] : [])]),
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
export async function getPasalWork(uri: string, key: string, signal?: AbortSignal) {
  if (!validUri(uri)) return undefined;
  const work = await cached('work:' + digest('v2:' + uri), async () => {
    const result = record(await readJson('laws' + uri, key, signal));
    const found = workOf(result.work);
    return found?.uri === uri ? found : null;
  });
  return work ?? undefined;
}

async function searchPasal(query: Search, key: string, signal?: AbortSignal): Promise<LegalRef[]> {
  if (query.type === 'UUD' && !query.article && !query.topic) {
    // This public FRBR identifier is returned by Pasal.id for the base Constitution.
    // An exact work lookup avoids ranking amendments ahead of it.
    const charter = await getPasalWork('/akn/id/act/uud/1945/original', key, signal);
    if (charter?.type === 'UUD' && charter.year === '1945' && charter.url) {
      return [metadataRef({ work: charter, article: '', url: charter.url })];
    }
  }
  const parameters = new URLSearchParams({ q: query.q, limit: '3' });
  if (query.type) parameters.set('type', query.type);
  const hits = await cached('search:v2:' + digest(parameters.toString()), async () => {
    const result = record(await readJson('search?' + parameters, key, signal));
    if (!Array.isArray(result.results)) throw new Error('invalid_pasal_results');
    const seen = new Set<string>();
    return result.results.slice(0, 3).flatMap((item) => {
      const hit = hitOf(item, query);
      if (!hit || seen.has(hit.work.uri + '#' + hit.article)) return [];
      seen.add(hit.work.uri + '#' + hit.article);
      return [hit];
    });
  });
  // A work-level request for the Constitution should open the instrument before an amendment.
  if (query.type === 'UUD' && !query.article && !query.topic) {
    const original = hits.find(hit => hit.work.uri.endsWith('/original'));
    if (original) return [metadataRef(original)];
  }
  const primary = hits[0];
  if (!primary) return [];
  // Search already supplies a usable identity. Detail can verify the status without retaining its content.
  let verified: Work | undefined;
  try {
    verified = await getPasalWork(primary.work.uri, key, signal);
  } catch {
    signal?.throwIfAborted();
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

type Outcome = 'found' | 'no-results' | 'unavailable' | 'disabled' | 'needs-topic' | 'sample-empty' | 'charter-only';
type Lookup = { refs: LegalRef[]; outcome: Outcome };
interface DiscoveryOptions { signal?: AbortSignal; status?: (status: LegalSearchStatus) => void }
async function privateLookup(w: Workspace, query?: Search, options: DiscoveryOptions = {}): Promise<Lookup> {
  const key = token();
  options.signal?.throwIfAborted();
  if (!key || legalDiscoveryMode(w) !== 'available') {
    options.status?.(key ? 'unavailable' : 'not_configured');
    return { refs: [], outcome: 'unavailable' };
  }
  if (!query) {
    options.status?.('no_query');
    return { refs: [], outcome: 'needs-topic' };
  }
  try {
    const refs = await searchPasal(query, key, options.signal);
    options.status?.(refs.length ? 'found' : 'no_matches');
    return { refs, outcome: refs.length ? 'found' : 'no-results' };
  } catch {
    options.signal?.throwIfAborted();
    interrupted = { fingerprint: digest(key), until: Date.now() + 60000 };
    options.status?.('unavailable');
    return { refs: [], outcome: 'unavailable' };
  }
}

/** An automatic finding may look up only the named law within an independently checked quotation. */
export function discoverCitedLegal(w: Workspace, quotations: string[]): Promise<LegalRef[]> {
  const query = quotations
    .map((quote) => searchTerms(quote, true))
    .find((term) => term?.numbered || term?.code || term?.type === 'UUD');
  return privateLookup(w, query).then(result => result.refs);
}

export async function discoverLegal(
  w: Workspace,
  text: string,
  refs: (Citation | ContextRef)[],
  options: DiscoveryOptions = {},
): Promise<LegalRef[]> {
  const related = contextLaws(w, refs),
    query = searchTerms(text);
  if (w.caseRecord.label === 'synthetic') {
    options.status?.('sample');
    const words = ' ' + (text.toLowerCase().match(/[\p{L}\d]+/gu) ?? []).join(' ') + ' ';
    const rank = samples.map((sample) => {
      const seen = w.legal.find(
        (row) => row.regulation === sample.regulation && row.article === sample.article,
      );
      let score = 0;
      if (
        (query?.type !== 'UUD' || sample.type.toUpperCase() === 'UUD') &&
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
  return [...saved, ...(await privateLookup(w, safeQuery, options)).refs].slice(0, 6);
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

function questionContext(w: Workspace, refs: ContextRef[], lang: Lang, direct?: Search, category?: string) {
  const selected = refs.filter(ref => ref.kind !== 'case');
  // An attached line or passage is an exact scope. A selected hearing, document or board includes its own records.
  const keys = contextKeys(w, selected.filter(ref => ref.kind !== 'statement' && ref.kind !== 'passage'));
  for (const ref of selected) if (ref.kind === 'statement' || ref.kind === 'passage') keys.add(ref.kind + ':' + ref.id);
  const sources = caseSources(w, lang).filter(source => !selected.length || keys.has(source.kind + ':' + source.id));
  const candidates = sources.flatMap(source => {
    const term = searchTerms(source.text) ?? searchTerms(source.group);
    return term ? [{ term, source }] : [];
  });
  const matchesCategory = (term: Search) => category === 'UUD' ? term.type === 'UUD' || constitutionalTopic(term) :
    category !== 'UU' || (term.type !== 'UUD' && (!term.numbered || term.numbered.type === 'UU'));
  const compatible = candidates.filter(item => matchesCategory(item.term));
  // Prefer an explicit identifier in the record; a stated question always wins over inference.
  const same = direct && compatible.find(({ term }) => term.q === direct.q);
  const counts = new Map<string, number>();
  for (const { term } of compatible) counts.set(term.q, (counts.get(term.q) ?? 0) + 1);
  const rank = ({ term }: typeof compatible[number]) =>
    (term.numbered || term.code || term.type === 'UUD' && term.article ? sources.length + 1 : 0) + counts.get(term.q)!;
  const contextual = compatible.sort((a, b) => rank(b) - rank(a))[0];
  const generalCharter = direct?.type === 'UUD' && !direct.article && !direct.topic;
  let query = direct;
  if (generalCharter && contextual && (contextual.term.article || constitutionalTopic(contextual.term)))
    query = { ...contextual.term, type: 'UUD' };
  if (!query) {
    query = contextual?.term;
    if (!query && !selected.length) {
      const description = searchTerms([w.caseRecord.title, w.caseRecord.summary[lang]].join(' '));
      if (description && matchesCategory(description)) query = description;
    }
    if (query && category === 'UU' && !query.numbered) query = { ...query, type: 'UU' };
  }
  const source = same?.source ?? (!direct || generalCharter ? contextual?.source : undefined) ?? (selected.length ? sources[0] : undefined);
  return { query, source };
}

function lawReplyText(lookup: Lookup, lang: Lang, query: Search | undefined, category: string | undefined, source?: Source) {
  const en = lang === 'en';
  const name = lookup.refs[0];
  let text: string;
  switch (lookup.outcome) {
    case 'found': {
      const label = name.regulation + (name.article ? ', ' + name.article : '');
      const provider = name.provider === 'sample' ? (en ? 'The synthetic case index' : 'Indeks perkara sintetis') : 'Pasal.id';
      text = en ? provider + ' lists ' + label + '.' : provider + ' mencantumkan ' + label + '.';
      if (category === 'UUD' && !name.article) {
        text += en
          ? ' This identifies the Constitution. Which right, government action or court procedure should I look for in a particular article?'
          : ' Ini rujukan konstitusinya. Hak, tindakan pemerintah, atau prosedur persidangan apa yang ingin Anda telusuri ke pasal tertentu?';
      } else {
        text += en
          ? ' Open the linked provision to compare its wording and effective date with the facts before treating it as applicable.'
          : ' Buka rujukannya untuk membandingkan bunyi ketentuan dan tanggal berlakunya dengan fakta perkara sebelum menentukan penerapannya.';
      }
      break;
    }
    case 'charter-only':
      text = en ? 'Pasal.id did not verify an article for “' + query!.q + '”. Its work-level reference is ' + name.regulation + '. Which specific right or state action should we investigate?'
        : 'Pasal.id belum memverifikasi pasal untuk “' + query!.q + '”. Rujukan tingkat peraturannya adalah ' + name.regulation + '. Hak atau tindakan negara apa yang ingin diperiksa?';
      break;
    case 'no-results':
      text = en ? 'Pasal.id returned no verified match for “' + query!.q + '”. Try the regulation number, year or a more specific public legal topic.'
        : 'Pasal.id tidak menemukan rujukan terverifikasi untuk “' + query!.q + '”. Coba nomor peraturan, tahun, atau topik hukum yang lebih spesifik.';
      break;
    case 'unavailable':
      text = en ? 'Pasal.id is unavailable. I could not verify a legal reference for this question.'
        : 'Pasal.id sedang tidak tersedia. Rujukan hukum untuk pertanyaan ini belum dapat diverifikasi.';
      break;
    case 'disabled':
      text = en ? 'Legal discovery is switched off for this question. Enable Pasal.id to look up a regulation.'
        : 'Penelusuran hukum dinonaktifkan untuk pertanyaan ini. Aktifkan Pasal.id untuk mencari peraturan.';
      break;
    case 'sample-empty':
      text = en ? 'The synthetic case has no matching entry in its sample legal index. A private case can search Pasal.id.'
        : 'Indeks contoh di perkara sintetis ini tidak memuat rujukan yang cocok. Perkara privat dapat menelusuri Pasal.id.';
      break;
    case 'needs-topic':
      text = en ? 'Which legal issue should I look up? Name the subject or attach the document or testimony that identifies it. A regulation number and year also work.'
        : 'Isu hukum apa yang ingin ditelusuri? Sebutkan topiknya atau lampirkan dokumen maupun keterangan yang memuatnya. Nomor dan tahun peraturan juga bisa digunakan.';
  }
  if (source) {
    const quote = source.text.slice(0, 300);
    text += '\n\n' + (en ? 'From the case record' : 'Dari berkas perkara') + ' [1]\n“' + quote + '”' + (quote.length < source.text.length ? '…' : '');
  }
  return text;
}

/** Answer explicit legal questions even when the question's words do not occur in case evidence. */
export async function answerLawQuestion(w: Workspace, text: string, refs: ContextRef[], lang: Lang, enabled: boolean, options: DiscoveryOptions = {}) {
  if (!isLawQuestion(text)) return;
  const category = lawCategory(text), { query, source } = questionContext(w, refs, lang, searchTerms(text), category);
  let lookup: Lookup;
  if (!enabled) lookup = { outcome: 'disabled', refs: [] };
  else if (w.caseRecord.label === 'synthetic') {
    const sample = await discoverLegal(w, query?.q ?? text, refs, options);
    lookup = { outcome: sample.length ? 'found' : 'sample-empty', refs: sample };
  } else {
    lookup = await privateLookup(w, query, options);
    if (lookup.outcome === 'no-results' && query?.type === 'UUD' && (query.topic || query.article)) {
      const base = await privateLookup(w, { q: 'UUD 1945', article: '', type: 'UUD' }, options);
      if (base.refs.length) lookup = { outcome: 'charter-only', refs: base.refs };
    }
  }
  const answer: ChatMessage = {
    id: randomUUID(), role: 'assistant', mode: 'sources-only',
    text: { id: lawReplyText(lookup, 'id', query, category, source), en: lawReplyText(lookup, 'en', query, category, source) },
    citations: source ? [{ kind: source.kind, id: source.id }] : [],
  };
  return { answer, discoveries: lookup.refs };
}
