import type { Workspace } from '../../domain';
import { rateLimit } from '../auth';
import { transaction } from '../db';
import { hasSemanticEvidenceIn, searchSemanticIn, type SemanticMatch } from '../semantic-index';
import { embeddingChunks, semanticSources } from '../semantic-sources';
import { embedEvidence, embeddingsConfigured } from './embeddings';

export type SourceRef = { kind: string; id: string };
export const sourceKey = (ref: SourceRef) => ref.kind + ':' + ref.id;

export async function semanticMatches(
  w: Workspace, orgId: string | undefined, query: string, allowed?: SourceRef[],
): Promise<SemanticMatch[]> {
  if (!orgId || !process.env.DATABASE_URL || !embeddingsConfigured() ||
      w.caseRecord.label !== 'private' || w.caseRecord.archived || allowed?.length === 0 || !query.trim()) return [];
  const caseId = w.caseRecord.id;
  try {
    const ready = await transaction(async db => {
      if (!await hasSemanticEvidenceIn(db, orgId, caseId)) return false;
      await rateLimit(db, 'semantic-query', orgId, 180, 60_000);
      return true;
    });
    if (!ready) return [];
    const [vector] = await embedEvidence([embeddingChunks(query.trim())[0]]);
    const matches = await transaction(db => searchSemanticIn(db, { orgId, caseId, vector, allowed, limit: 32 }));
    if (!matches.length) return [];
    const current = new Map(semanticSources(w).map(s => [sourceKey(s), s.fingerprint]));
    return matches.filter(s => s.score >= 0.3 && current.get(sourceKey(s)) === s.fingerprint);
  } catch {
    return [];
  }
}

/** Reciprocal rank fusion keeps overlapping evidence prominent across two different score scales. */
export function mergeEvidenceRanks<T extends SourceRef>(
  lexical: T[], semantic: SourceRef[], candidates: T[], limit: number,
): T[] {
  if (!semantic.length) return lexical.slice(0, limit);
  const scores = new Map<string, number>();
  for (const list of [lexical, semantic]) {
    list.forEach((source, index) => {
      const key = sourceKey(source);
      scores.set(key, (scores.get(key) ?? 0) + 1 / (61 + index));
    });
  }
  const records = new Map(candidates.map(item => [sourceKey(item), item]));
  return [...scores].sort((a, b) => b[1] - a[1]).flatMap(([id]) => {
    const hit = records.get(id);
    return hit ? [hit] : [];
  }).slice(0, limit);
}
