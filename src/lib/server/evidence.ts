import { randomUUID } from 'node:crypto';
import type {
  Board,
  BoardCard,
  BoardKind,
  BoardLink,
  Citation,
  ContextRef,
  Excerpt,
  NodeRef,
  Relation,
  Workspace,
} from '../domain';
import {
  bilingual,
  bool,
  choice,
  conflict,
  invalid,
  number,
  object,
  required,
  string,
  type Fields,
} from './validation';

export const relations: Relation[] = ['supports', 'conflicts', 'context', 'related'];
export const resourceKinds = {
  hearing: 'hearings',
  finding: 'findings',
  document: 'documents',
  passage: 'passages',
  statement: 'statements',
  connection: 'connections',
  board: 'boards',
} as const;
export function contextsOf(w: Workspace, value: unknown): ContextRef[] {
  if (value === undefined) return [{ kind: 'case' }];
  if (!Array.isArray(value) || value.length > 6) invalid('contexts');
  return value.map((raw) => {
    const ref = object(raw, 'contexts');
    if (ref.kind === 'documents' || ref.kind === 'case') return { kind: ref.kind };
    const kind = choice(ref.kind, Object.keys(resourceKinds) as (keyof typeof resourceKinds)[], 'kind');
    const id = string(ref.id, 'id', 100);
    if (!w[resourceKinds[kind]].some((item) => item.id === id)) invalid('contexts');
    return { kind, id };
  });
}
export function hasCitation(w: Workspace, c: Citation) {
  return Boolean(resourceKinds[c.kind]) && w[resourceKinds[c.kind]].some((row) => row.id === c.id);
}
export function patchFinding(w: Workspace, id: string, fields: Fields) {
  const finding = required(w.findings, (f) => f.id === id);
  if ('reviewed' in fields) finding.reviewed = bool(fields.reviewed, 'reviewed');
  if ('note' in fields) finding.note = string(fields.note, 'note', 12000, true);
  finding.isNew = false;
  return finding;
}
export function patchStatement(w: Workspace, id: string, fields: Fields) {
  const statement = required(w.statements, (s) => s.id === id);
  if ('flagged' in fields) statement.flagged = bool(fields.flagged, 'flagged');
  if ('note' in fields) statement.note = string(fields.note, 'note', 6000, true);
  return statement;
}

function node(w: Workspace, unknown: unknown): NodeRef {
  const raw = object(unknown, 'node'),
    kind = choice(raw.kind, ['statement', 'passage'], 'kind'),
    id = string(raw.id, 'id', 100);
  if (!w[resourceKinds[kind]].some((item) => item.id === id)) invalid('node');
  return { kind, id };
}
export function addConnection(w: Workspace, fields: Fields) {
  const from = node(w, fields.from),
    to = node(w, fields.to);
  const pair = [from.kind + ':' + from.id, to.kind + ':' + to.id].sort().join('/');
  if (from.kind === to.kind && from.id === to.id) invalid('to');
  if (
    w.connections.some(
      (c) => [c.from.kind + ':' + c.from.id, c.to.kind + ':' + c.to.id].sort().join('/') === pair,
    )
  )
    conflict('These sources are already paired.');
  const relation = choice(fields.relation ?? 'related', relations, 'relation');
  const item = {
    id: randomUUID(),
    from,
    to,
    relation,
    reviewed: true,
    basis: 'manual' as const,
    why: bilingual('', 'why', 300, true),
  };
  w.connections.push(item);
  return item;
}
export function patchConnection(w: Workspace, id: string, fields: Fields) {
  const item = required(w.connections, (c) => c.id === id);
  if ('relation' in fields) item.relation = choice(fields.relation, relations, 'relation');
  if ('reviewed' in fields) item.reviewed = bool(fields.reviewed, 'reviewed');
  return item;
}
export function addBoard(w: Workspace, fields: Fields) {
  const board: Board = {
    id: randomUUID(),
    name: string(fields.name, 'name', 100),
    version: 1,
    suggest: true,
    dismissed: [],
    cards: [],
    links: [],
    excerpts: {},
    updated: Date.now(),
  };
  w.boards.push(board);
  return board;
}
function boardCard(w: Workspace, raw: unknown, excerpts: Record<string, Excerpt>): BoardCard {
  const card = object(raw, 'cards'),
    kind = choice(
      card.kind,
      ['finding', 'statement', 'passage', 'document', 'excerpt'] as BoardKind[],
      'kind',
    ),
    id = string(card.id, 'id', 100);
  if (
    kind === 'excerpt' ? !Object.hasOwn(excerpts, id) : !w[resourceKinds[kind]].some((row) => row.id === id)
  )
    invalid('cards');
  const key = kind + ':' + id;
  if (card.key !== key) invalid('key');
  return {
    kind,
    id,
    key,
    x: number(card.x, 'x', -1000000, 1000000),
    y: number(card.y, 'y', -1000000, 1000000),
    note: string(card.note, 'note', 12000, true),
  };
}
export function updateBoard(w: Workspace, id: string, fields: Fields) {
  const b = required(w.boards, (board) => board.id === id);
  if (fields.version !== b.version) conflict('The board has changed. Reload to use the latest version.');
  const excerpts: Record<string, Excerpt> = Object.create(null);
  for (const [key, raw] of Object.entries(object(fields.excerpts ?? b.excerpts, 'excerpts'))) {
    if (!/^[\w-]{1,100}$/.test(key) || Object.keys(excerpts).length >= 500) invalid('excerpts');
    const item = object(raw, 'excerpts'),
      docId = string(item.docId, 'docId', 100),
      doc = required(w.documents, (d) => d.id === docId);
    const page = number(item.page, 'page', 1, doc.pages),
      text = string(item.text, 'text', 6000);
    const passageId = item.passageId ? string(item.passageId, 'passageId', 100) : undefined;
    if (passageId && !w.passages.some((p) => p.id === passageId && p.docId === docId && p.page === page))
      invalid('passageId');
    excerpts[key] = { docId, page, text, passageId };
  }
  const rawCards = fields.cards ?? b.cards,
    rawLinks = fields.links ?? b.links;
  if (!Array.isArray(rawCards) || rawCards.length > 500 || !Array.isArray(rawLinks) || rawLinks.length > 1500)
    invalid('cards');
  const cards = rawCards.map((raw) => boardCard(w, raw, excerpts)),
    keys = new Set(cards.map((c) => c.key));
  if (keys.size !== cards.length) invalid('cards');
  const usedIds = new Set<string>();
  const links: BoardLink[] = rawLinks.map((raw) => {
    const line = object(raw, 'links'),
      from = string(line.from, 'from', 180),
      to = string(line.to, 'to', 180),
      id = string(line.id, 'id', 100);
    if (!keys.has(from) || !keys.has(to) || from === to || usedIds.has(id)) invalid('links');
    usedIds.add(id);
    const connectionId = line.connectionId ? string(line.connectionId, 'connectionId', 100) : undefined;
    const findingId = line.findingId ? string(line.findingId, 'findingId', 100) : undefined;
    if (connectionId && !w.connections.some((c) => c.id === connectionId)) invalid('connectionId');
    if (findingId && !w.findings.some((f) => f.id === findingId)) invalid('findingId');
    return {
      id,
      from,
      to,
      label: string(line.label, 'label', 220, true),
      relation: choice(line.relation, relations, 'relation'),
      connectionId,
      findingId,
    };
  });
  const dismissed = fields.dismissed ?? b.dismissed;
  if (!Array.isArray(dismissed) || dismissed.length > 1000) invalid('dismissed');
  Object.assign(b, {
    cards,
    links,
    excerpts,
    dismissed: dismissed.map((k) => string(k, 'dismissed', 300)),
    version: b.version + 1,
    updated: Date.now(),
  });
  if ('name' in fields) b.name = string(fields.name, 'name', 100);
  if ('suggest' in fields) b.suggest = bool(fields.suggest, 'suggest');
  return b;
}
export function addBoardCard(w: Workspace, id: string, fields: Fields) {
  const board = required(w.boards, (b) => b.id === id);
  const kind = choice(
    fields.kind,
    ['finding', 'statement', 'passage', 'document', 'excerpt'] as BoardKind[],
    'kind',
  );
  const refId = kind === 'excerpt' ? randomUUID() : string(fields.id, 'id', 100);
  const key = kind + ':' + refId;
  if (board.cards.some((c) => c.key === key)) return board;
  const slot = board.cards.length;
  const cards = [
    ...board.cards,
    { kind, id: refId, key, x: 24 + Math.floor(slot % 3) * 304, y: 24 + Math.floor(slot / 3) * 158 },
  ];
  const excerpts =
    kind === 'excerpt'
      ? {
          ...board.excerpts,
          [refId]: { docId: fields.docId, page: fields.page, text: fields.text, passageId: fields.passageId },
        }
      : board.excerpts;
  return updateBoard(w, id, { version: board.version, cards, excerpts });
}
