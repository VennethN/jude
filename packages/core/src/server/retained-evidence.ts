import type { Board, Citation, ContextRef, Workspace } from '../domain';

export type RemovedSource = { kind: 'documents' | 'hearings'; id: string };
export const retainedMarker = '{"retained":true}';

function mergeHidden<T>(raw: T[], before: T[], after: T[], key: (value: T) => string): T[] {
  const visible = new Set(before.map(key)),
    present = new Set(after.map(key)),
    merged = [...after];
  raw.forEach((item, index) => {
    if (!visible.has(key(item)) && !present.has(key(item)))
      merged.splice(Math.min(index, merged.length), 0, item);
  });
  return merged;
}

function restoreBoard(raw: Board, before: Board, edited: Board) {
  edited.cards = mergeHidden(raw.cards, before.cards, edited.cards, (card) => card.key);
  edited.links = mergeHidden(raw.links, before.links, edited.links, (link) => link.id);
  edited.dismissed = mergeHidden(raw.dismissed, before.dismissed, edited.dismissed, (key) => key);
  for (const [key, excerpt] of Object.entries(raw.excerpts))
    if (!(key in before.excerpts)) edited.excerpts[key] = excerpt;
}

/** Build the readable graph while a document or hearing is in its restoration period. */
export function withoutRemoved(raw: Workspace, removed: RemovedSource[]): Workspace {
  const w = structuredClone(raw);
  const docs = new Map(
    raw.documents
      .filter((d) => removed.some((r) => r.kind === 'documents' && r.id === d.id))
      .map((d) => [d.id, d]),
  );
  const hearings = new Set(removed.filter((r) => r.kind === 'hearings').map((r) => r.id));
  const passages = new Map(raw.passages.filter((p) => docs.has(p.docId)).map((p) => [p.id, p]));
  const unavailable = new Map<string, string>();
  const mark = (kind: string, id: string, text: string) =>
    unavailable.set(kind + ':' + id, text.slice(0, 600));
  for (const d of docs.values()) mark('document', d.id, d.title);
  for (const h of w.hearings) if (hearings.has(h.id)) mark('hearing', h.id, h.title.id);
  for (const p of passages.values()) mark('passage', p.id, p.text);
  for (const s of w.statements) if (hearings.has(s.hearingId)) mark('statement', s.id, s.text);
  for (const f of w.findings) if (hearings.has(f.hearingId)) mark('finding', f.id, f.title.id);
  const gone = (kind: string, id: string) => unavailable.has(kind + ':' + id);
  w.documents = w.documents.filter((d) => !docs.has(d.id));
  w.hearings = w.hearings.filter((h) => !hearings.has(h.id));
  w.statements = w.statements.filter((s) => !gone('statement', s.id));
  w.passages = w.passages.filter((p) => !passages.has(p.id));
  w.findings = w.findings.filter((f) => !gone('finding', f.id));
  for (const f of w.findings) {
    const lost = f.sources.flatMap((source) => {
      const p = passages.get(source.passageId);
      return p ? [{ ...source, documentTitle: docs.get(p.docId)!.title, page: p.page }] : [];
    });
    if (lost.length) {
      f.unavailableSources = [...(f.unavailableSources ?? []), ...lost];
      f.sources = f.sources.filter((s) => !passages.has(s.passageId));
    }
  }
  w.connections = w.connections.filter((c) => {
    if (!gone(c.from.kind, c.from.id) && !gone(c.to.kind, c.to.id)) return true;
    mark('connection', c.id, c.why.id);
    return false;
  });
  w.replies = w.replies.filter(
    (r) =>
      !hearings.has(r.hearingId) &&
      !r.suggestions.some((s) => 'id' in s.basis && gone(s.basis.kind, s.basis.id)),
  );
  for (const b of w.boards) {
    for (const [id, excerpt] of Object.entries(b.excerpts)) {
      if (docs.has(excerpt.docId)) {
        mark('excerpt', id, excerpt.text);
        delete b.excerpts[id];
      }
    }
    b.cards = b.cards.filter((card) => !gone(card.kind, card.id));
    b.links = b.links.filter(
      (link) =>
        !unavailable.has(link.from) &&
        !unavailable.has(link.to) &&
        !(link.findingId && gone('finding', link.findingId)) &&
        !(link.connectionId && gone('connection', link.connectionId)),
    );
    b.dismissed = b.dismissed.filter((key) => key.split('|').every((part) => !unavailable.has(part)));
  }
  function snapshot<T extends Citation | ContextRef>(source: T): T {
    if (!('id' in source)) return source;
    const text = unavailable.get(source.kind + ':' + source.id);
    return text === undefined ? source : { ...source, unavailable: true, snapshot: text };
  }
  for (const t of w.threads)
    for (const m of t.messages) {
      if (m.citations) m.citations = m.citations.map(snapshot);
      if (m.contexts) m.contexts = m.contexts.map(snapshot);
    }
  return w;
}

/** Merge edits to visible records back into their canonical graph so an Undo also restores links. */
export function preserveHidden(raw: Workspace, before: Workspace, edited: Workspace) {
  for (const finding of edited.findings) {
    const original = raw.findings.find((f) => f.id === finding.id);
    const visible = before.findings.find((f) => f.id === finding.id);
    if (!original || !visible) continue;
    finding.sources = mergeHidden(
      original.sources,
      visible.sources,
      finding.sources,
      (source) => source.passageId,
    );
    if (original.unavailableSources) finding.unavailableSources = original.unavailableSources;
    else delete finding.unavailableSources;
  }
  for (const board of edited.boards) {
    const original = raw.boards.find((b) => b.id === board.id);
    const visible = before.boards.find((b) => b.id === board.id);
    if (original && visible) restoreBoard(original, visible, board);
  }
  // Historical messages are append-only. Their source snapshots are projected again on read.
  for (const thread of edited.threads) {
    const original = raw.threads.find((t) => t.id === thread.id);
    if (!original) continue;
    const history = new Map(original.messages.map((m) => [m.id, m]));
    thread.messages = thread.messages.map((m) => history.get(m.id) ?? m);
  }
  const sourceGroups = [
    'hearings',
    'statements',
    'documents',
    'passages',
    'findings',
    'connections',
    'replies',
  ] as const;
  for (const kind of sourceGroups) {
    const target = edited[kind] as { id: string }[];
    target.splice(
      0,
      target.length,
      ...mergeHidden(
        raw[kind] as { id: string }[],
        before[kind] as { id: string }[],
        target,
        (item) => item.id,
      ),
    );
  }
}
