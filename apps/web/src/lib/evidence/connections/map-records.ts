import type { Lang, Workspace, L10n } from '@jude/core/domain';
import { displaySpeaker, displayTitle } from '$lib/workspace/format';
import { casePath, clock, local, meaningful, statuses } from '../records';
import type { Kind } from '../graph';
import { mapText, type MapKey } from './map-copy';

export const relationOrder = ['conflicts', 'context', 'supports', 'related'] as const;
export const idOf = (key: string) => key.slice(key.indexOf(':') + 1);
export const kindOf = (key: string) => key.slice(0, key.indexOf(':')) as Kind;
export type IconKind = Kind | 'hearing' | 'document';

export function mapRecords(w: Workspace, lang: Lang) {
  const byId = <T extends { id: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
  const hearings = byId(w.hearings),
    statements = byId(w.statements),
    findings = byId(w.findings),
    documents = byId(w.documents),
    passages = byId(w.passages),
    speakers = byId(w.speakers);
  const t = (key: MapKey, values?: Record<string, string | number>) => mapText(lang, key, values);
  const l = (text?: L10n | string) => local(text, lang);
  const hearing = (id?: string) => (id ? hearings.get(id) : undefined);
  const statement = (id: string) => statements.get(id);
  const finding = (id: string) => findings.get(id);
  const doc = (id: string) => documents.get(id);
  const documentName = (id: string) => {
    const document = doc(id);
    return document ? displayTitle(document, lang) : undefined;
  };
  const passage = (id: string) => passages.get(id);
  const speaker = (id: string) => speakers.get(id);
  const speakerName = (sp: ReturnType<typeof speaker>) => (sp ? displaySpeaker(w.speakers, sp.id, lang) : '');
  const shortName = (sp: ReturnType<typeof speaker>) =>
    speakerName(sp).replace(/^(Saksi|Witness|Terdakwa|Defendant)\s+/i, '');
  function whereOf(key: string) {
    const id = idOf(key),
      kind = kindOf(key);
    if (kind === 'statement') {
      const s = statement(id),
        h = hearing(s?.hearingId);
      return s && h
        ? [speakerName(speaker(s.speakerId)), t('common.hearingN', { n: h.number }), clock(s.t)].join(' · ')
        : '';
    }
    if (kind === 'passage') {
      const p = passage(id);
      return p ? [documentName(p.docId), t('common.page', { n: p.page })].filter(Boolean).join(' · ') : '';
    }
    const f = finding(id),
      s = f && statement(f.statementId);
    return f ? [statuses[f.status][lang], s && clock(s.t)].filter(Boolean).join(' · ') : '';
  }
  function groupName(members: Set<string>, picked: string[]) {
    const group = w.findings.filter((f) => members.has('finding:' + f.id));
    const f = group.find((f) => meaningful(f.status)) ?? group[0];
    return f
      ? l(f.title)
      : t('cx.group.around', {
          what:
            picked.length > 1
              ? (documentName(passage(idOf(picked[0]))?.docId ?? '') ?? whereOf(picked[0]))
              : picked[0]
                ? whereOf(picked[0])
                : ''
        });
  }
  return {
    t,
    l,
    hearing,
    statement,
    finding,
    doc,
    passage,
    speaker,
    speakerName,
    shortName,
    whereOf,
    groupName,
    findingPath: (id: string) => casePath(w) + '/findings/' + encodeURIComponent(id),
    statementsOf: (id: string) => w.statements.filter((s) => s.hearingId === id).sort((a, b) => a.t - b.t),
    passagesOf: (id: string) => w.passages.filter((p) => p.docId === id).sort((a, b) => a.page - b.page)
  };
}
