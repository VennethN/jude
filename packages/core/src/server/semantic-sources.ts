import { createHash } from 'node:crypto';
import type { Workspace } from '../domain';

export type SemanticKind = 'passage' | 'statement' | 'finding';
export interface SemanticSource {
  kind: SemanticKind;
  id: string;
  text: string;
  fingerprint: string;
  chunks: string[];
}

// A UTF-8 byte cannot encode more than one token. This conservative bound also
// handles languages and symbols whose token count differs substantially from English.
export function embeddingChunks(text: string, bytes = 6000): string[] {
  const chunks: string[] = [];
  let chunk = '', size = 0;
  for (const point of text) {
    const length = Buffer.byteLength(point, 'utf8');
    if (size + length > bytes && chunk) {
      chunks.push(chunk);
      chunk = '';
      size = 0;
    }
    chunk += point;
    size += length;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/** Only current evidence from this private case is eligible for external embedding. */
export function semanticSources(w: Workspace): SemanticSource[] {
  if (w.caseRecord.label !== 'private') return [];
  const sources: SemanticSource[] = [];
  const add = (kind: SemanticKind, id: string, text: string, location: unknown) => {
    if (!text.trim()) return;
    sources.push({
      kind, id, text,
      fingerprint: createHash('sha256').update(JSON.stringify([kind, id, location, text])).digest('hex'),
      chunks: embeddingChunks(text),
    });
  };
  const docs = new Set(w.documents.filter((d) => d.caseId === w.caseRecord.id).map((d) => d.id));
  const hearings = new Set(w.hearings.filter((h) => h.caseId === w.caseRecord.id).map((h) => h.id));
  for (const p of w.passages) if (docs.has(p.docId)) add('passage', p.id, p.text, [p.docId, p.page]);
  for (const s of w.statements) if (hearings.has(s.hearingId)) add('statement', s.id, s.text, [s.hearingId, s.t]);
  for (const f of w.findings) if (hearings.has(f.hearingId)) {
    const text = [...new Set([f.title.id, f.title.en, f.explanation.id, f.explanation.en].filter(Boolean))].join('\n');
    add('finding', f.id, text, [f.hearingId, f.statementId]);
  }
  return sources;
}
