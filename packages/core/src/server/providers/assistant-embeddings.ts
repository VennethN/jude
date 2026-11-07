import { createHash } from 'node:crypto';
import type { Workspace } from '../../domain';
import { transaction } from '../db';
import { embeddingChunks } from '../semantic-sources';
import { embedEvidence, embeddingModel, embeddingsConfigured } from './embeddings';
import type { Source } from './assistant';

const dimensions = 512;
const batchSize = 24;
// Bound first-question cost. Subsequent questions resume missing chunks.
const maxNewChunks = 96;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const entityKind = (source: Source) => source.kind === 'passage' ? 'passages' : source.kind === 'statement' ? 'statements' : 'findings';
const identity = (source: Source) => source.kind + ':' + source.id;
const validVector = (v: unknown): v is number[] => Array.isArray(v) && v.length === dimensions && v.every(n => typeof n === 'number' && Number.isFinite(n));

export function cosine(a: number[], b: number[]) {
  let dot = 0, left = 0, right = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; left += a[i] ** 2; right += b[i] ** 2; }
  return left && right ? dot / Math.sqrt(left * right) : 0;
}

export async function localSemanticSources(w: Workspace, orgId: string, sources: Source[], lexical: Source[], query: string, signal?: AbortSignal) {
  if (!embeddingsConfigured()) throw new Error('embedding_provider_missing');
  const model = embeddingModel();
  const modelKey = model + ':' + dimensions;
  const priority = new Set(lexical.map(identity));
  const chunks = sources.flatMap(source => {
    const result = [];
    let previous = '';
    for (const [chunk, piece] of embeddingChunks(source.text, 5000).entries()) {
      const text = [...previous].slice(-200).join('') + piece;
      const input = source.group.slice(0, 500) + '\n' + text;
      result.push({ source: { ...source, text }, input, chunk, hash: hash(input), kind: entityKind(source) });
      previous = piece;
    }
    return result;
  });
  const cached = await transaction(db => db.query<{kind: string; source_id: string; chunk: number; input_hash: string; vector: string}>(
    'SELECT e.kind,e.source_id,e.chunk,e.input_hash,e.vector FROM assistant_embeddings e JOIN cases c ON c.id=e.case_id WHERE e.case_id=$1 AND e.model=$2 AND c.org_id=$3 AND c.deleted_at IS NULL', [w.caseRecord.id, modelKey, orgId],
  ));
  const vectors = new Map<string, number[]>();
  for (const row of cached) {
    try {
      const vector: unknown = JSON.parse(row.vector);
      if (validVector(vector)) vectors.set([row.kind, row.source_id, row.chunk, row.input_hash].join(':'), vector);
    } catch { /* A damaged cache entry is regenerated. */ }
  }
  const cacheKey = (chunk: typeof chunks[number]) => [chunk.kind, chunk.source.id, chunk.chunk, chunk.hash].join(':');
  const missing = chunks.filter(c => !vectors.has(cacheKey(c)))
    .sort((a, b) => Number(priority.has(identity(b.source))) - Number(priority.has(identity(a.source))));
  const pending = missing.slice(0, maxNewChunks);
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    signal?.throwIfAborted();
    const batch = pending.slice(offset, offset + batchSize);
    const embedded = await embedEvidence(batch.map(c => c.input), signal, dimensions);
    const output = new Map(embedded.map((vector, index) => [index, vector]));
    if (batch.some((_, i) => !validVector(output.get(i)))) throw new Error('invalid_embeddings');
    signal?.throwIfAborted();
    await transaction(async db => {
      for (const [i, c] of batch.entries()) {
        const vector = output.get(i)!;
        // Deletion may happen while embedding; never recreate a removed source.
        await db.query(
          'INSERT INTO assistant_embeddings(case_id,kind,source_id,model,chunk,input_hash,vector) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE EXISTS (SELECT 1 FROM case_entities e JOIN cases c ON c.id=e.case_id WHERE e.case_id=$1 AND e.kind=$2 AND e.id=$3 AND c.org_id=$8 AND c.deleted_at IS NULL) ON CONFLICT(case_id,kind,source_id,model,chunk) DO UPDATE SET input_hash=excluded.input_hash,vector=excluded.vector',
          [w.caseRecord.id, c.kind, c.source.id, modelKey, c.chunk, c.hash, JSON.stringify(vector), orgId],
        );
        vectors.set(cacheKey(c), vector);
      }
    });
  }
  const [vector] = await embedEvidence([embeddingChunks(query)[0]], signal, dimensions);
  if (!validVector(vector)) throw new Error('invalid_query_embedding');
  const ranked = chunks.flatMap(c => {
    const candidate = vectors.get(cacheKey(c));
    const score = candidate ? cosine(vector, candidate) : 0;
    // Cosine is a ranking signal, not calibrated confidence across languages.
    // Keep positive candidates; the answer step must decline insufficient evidence.
    return score > 0 ? [{ source: c.source, score }] : [];
  }).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const semantic = ranked.filter(({ source }) => { const k = identity(source); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 16);
  const fused = new Map<string, {source: Source; score: number}>();
  for (const [rank, { source }] of semantic.entries()) fused.set(identity(source), { source, score: 1 / (60 + rank) });
  for (const [rank, source] of lexical.entries()) {
    const k = identity(source), prior = fused.get(k);
    fused.set(k, { source: prior?.source ?? source, score: (prior?.score ?? 0) + 1 / (60 + rank) });
  }
  return { sources: [...fused.values()].sort((a,b) => b.score-a.score).slice(0,16).map(c => c.source), partial: missing.length > maxNewChunks };
}
