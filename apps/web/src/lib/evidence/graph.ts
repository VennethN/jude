import type { Lang, Relation, Status, Workspace } from '@jude/core/domain';
import { evidenceKey, sourceOf, type Source } from './records';

export type Kind = 'statement' | 'finding' | 'passage';
export type EvidenceRef = { kind: Kind; id: string };
export interface Pairing {
  key: string;
  from: string;
  to: string;
  relation: Relation;
  reviewed: boolean;
  source: 'link' | 'about' | 'cited';
  connectionId?: string;
  findingId?: string;
}
export interface MapNode {
  ref: EvidenceRef;
  source: Source;
  key: string;
}
export const statusRelation: Record<Status, Relation> = {
  potential_inconsistency: 'conflicts',
  context_needed: 'context',
  supported: 'supports',
  insufficient_evidence: 'related'
};

export function graphOf(w: Workspace, lang: Lang) {
  const nodes: MapNode[] = [];
  function append(ref: EvidenceRef) {
    const source = sourceOf(w, ref, lang);
    if (source) nodes.push({ ref, source, key: evidenceKey(ref) });
  }
  for (const s of w.statements) append({ kind: 'statement', id: s.id });
  for (const f of w.findings) append({ kind: 'finding', id: f.id });
  for (const p of w.passages) append({ kind: 'passage', id: p.id });
  const pairs: Pairing[] = [],
    seen = new Set<string>();
  const vertices = new Map(nodes.map((n) => [n.key, n]));
  function connect(pair: Pairing) {
    const key = [pair.from, pair.to].sort().join('|');
    if (seen.has(key) || !vertices.has(pair.from) || !vertices.has(pair.to)) return;
    seen.add(key);
    pairs.push(pair);
  }
  for (const c of w.connections)
    connect({
      key: c.id,
      from: evidenceKey(c.from),
      to: evidenceKey(c.to),
      relation: c.relation,
      reviewed: c.reviewed,
      source: 'link',
      connectionId: c.id
    });
  for (const f of w.findings) {
    const from = 'statement:' + f.statementId;
    connect({
      key: f.id + ':about',
      from,
      to: 'finding:' + f.id,
      relation: statusRelation[f.status],
      reviewed: f.reviewed,
      source: 'about',
      findingId: f.id
    });
    for (const s of f.sources)
      connect({
        key: f.id + ':' + s.passageId,
        from,
        to: 'passage:' + s.passageId,
        relation: s.relation,
        reviewed: f.reviewed,
        source: 'cited',
        findingId: f.id
      });
  }
  const adjacent = new Map<string, Set<string>>();
  for (const p of pairs) {
    if (!adjacent.has(p.from)) adjacent.set(p.from, new Set());
    if (!adjacent.has(p.to)) adjacent.set(p.to, new Set());
    adjacent.get(p.from)!.add(p.to);
    adjacent.get(p.to)!.add(p.from);
  }
  return { nodes, vertices, pairs, adjacent };
}

export function groupOf(keys: string[], adjacent: Map<string, Set<string>>) {
  const visited = new Set(keys),
    queue = [...keys];
  for (let i = 0; i < queue.length; i++) {
    for (const next of adjacent.get(queue[i]) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}
