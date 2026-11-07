import { displayTitle, displaySpeaker } from '$lib/workspace/format';
import type {
  Board,
  Citation,
  ContextRef,
  Lang,
  L10n,
  NodeRef,
  Relation,
  Status,
  Workspace
} from '@jude/core/domain';

export const statuses: Record<Status, L10n> = {
  potential_inconsistency: { id: 'Berbeda dari sumber', en: 'Potential inconsistency' },
  context_needed: { id: 'Perlu konteks', en: 'Context needed' },
  supported: { id: 'Didukung sumber', en: 'Supported' },
  insufficient_evidence: { id: 'Bukti belum cukup', en: 'Insufficient evidence' }
};

export const relations: Record<Relation, L10n> = {
  conflicts: { id: 'Berbeda', en: 'Conflicts' },
  context: { id: 'Konteks', en: 'Context' },
  supports: { id: 'Mendukung', en: 'Supports' },
  related: { id: 'Terkait', en: 'Related' }
};

export function local(text: string | L10n | undefined, lang: Lang) {
  return typeof text === 'string' ? text : (text?.[lang] ?? '');
}

export function clock(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), Math.floor(seconds % 60)]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}

export function dateLabel(value: string | number, lang: Lang) {
  const date = new Date(value);
  return Number.isFinite(+date)
    ? new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'Asia/Jakarta'
      }).format(date)
    : String(value);
}

export function casePath(workspace: Workspace) {
  return '/case/' + encodeURIComponent(workspace.caseRecord.id);
}

export function apiPath(workspace: Workspace, resource: string) {
  return '/api/cases/' + encodeURIComponent(workspace.caseRecord.id) + '/' + resource;
}

export function meaningful(status: Status) {
  return status === 'context_needed' || status === 'potential_inconsistency';
}

export const evidenceKey = (ref: { kind: string; id: string }) => ref.kind + ':' + ref.id;

type RecordRef = Citation | ContextRef | { kind: 'excerpt'; id: string };
export interface Source {
  key: string;
  label: string;
  text: string;
  href: string;
  kind: RecordRef['kind'];
}

export function sourceOf(w: Workspace, ref: RecordRef, lang: Lang, board?: Board): Source | undefined {
  const base = casePath(w);
  if (ref.kind === 'case' || ref.kind === 'documents') {
    const scope = ref.kind === 'case';
    return {
      key: ref.kind,
      kind: ref.kind,
      label: scope ? displayTitle(w.caseRecord, lang) : lang === 'id' ? 'Dokumen' : 'Documents',
      text: '',
      href: scope ? base : base + '/documents'
    };
  }
  const key = evidenceKey(ref);
  const id = encodeURIComponent(ref.id);
  const simple = (label: string, text: string, href: string) => ({ key, kind: ref.kind, label, text, href });
  switch (ref.kind) {
    case 'document': {
      const d = w.documents.find((r) => r.id === ref.id);
      return d && simple(displayTitle(d, lang), local(d.kind, lang), base + '/documents/' + id);
    }
    case 'passage': {
      const p = w.passages.find((r) => r.id === ref.id);
      const d = p && w.documents.find((r) => r.id === p.docId);
      return (
        p &&
        d &&
        simple(
          displayTitle(d, lang) + ' · ' + (lang === 'id' ? 'hal. ' : 'p. ') + p.page,
          p.text,
          base + '/documents/' + encodeURIComponent(d.id) + '?p=' + id
        )
      );
    }
    case 'statement': {
      const line = w.statements.find((r) => r.id === ref.id);
      const hearing = line && w.hearings.find((r) => r.id === line.hearingId);
      const name = line && displaySpeaker(w.speakers, line.speakerId, lang);
      return (
        line &&
        hearing &&
        simple(
          (lang === 'id' ? 'Sidang ' : 'Hearing ') +
            hearing.number +
            ' · ' +
            clock(line.t) +
            (name ? ' · ' + name : ''),
          line.text,
          base + '/hearings/' + encodeURIComponent(hearing.id) + '?s=' + id
        )
      );
    }
    case 'hearing': {
      const h = w.hearings.find((r) => r.id === ref.id);
      return (
        h &&
        simple(
          (lang === 'id' ? 'Sidang ' : 'Hearing ') + h.number,
          local(h.title, lang),
          base + '/hearings/' + id
        )
      );
    }
    case 'finding': {
      const f = w.findings.find((r) => r.id === ref.id);
      return (
        f && simple(local(f.title, lang), f.said || local(f.explanation, lang), base + '/findings/' + id)
      );
    }
    case 'board': {
      const b = w.boards.find((r) => r.id === ref.id);
      return b && simple(b.name, '', base + '/findings?view=board&board=' + id);
    }
    case 'excerpt': {
      const e = board?.excerpts[ref.id];
      const d = e && w.documents.find((r) => r.id === e.docId);
      return (
        d &&
        e &&
        simple(
          displayTitle(d, lang) + ' · ' + (lang === 'id' ? 'hal. ' : 'p. ') + e.page,
          e.text,
          base +
            '/documents/' +
            encodeURIComponent(d.id) +
            '?view=text' +
            (e.passageId ? '&p=' + encodeURIComponent(e.passageId) : '')
        )
      );
    }
    case 'connection': {
      const c = w.connections.find((r) => r.id === ref.id);
      return (
        c &&
        simple(
          relations[c.relation][lang],
          local(c.why, lang),
          base + '/connections?of=' + encodeURIComponent(evidenceKey(c.from))
        )
      );
    }
  }
}

export function nodeKey(value: string): NodeRef | undefined {
  const i = value.indexOf(':');
  const kind = value.slice(0, i);
  if (i > 0 && (kind === 'statement' || kind === 'passage')) return { kind, id: value.slice(i + 1) };
}

export function assistantPath(w: Workspace, ref: ContextRef) {
  const query = new URLSearchParams();
  query.set('context', 'id' in ref ? evidenceKey(ref) : ref.kind);
  return casePath(w) + '/assistant/new?' + query;
}

export function boardPath(w: Workspace, ref: { kind: string; id: string }) {
  return casePath(w) + '/findings?view=board&start=' + encodeURIComponent(evidenceKey(ref));
}
