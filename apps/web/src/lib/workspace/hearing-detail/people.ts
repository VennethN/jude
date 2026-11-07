import type { Lang, Role, Speaker, Statement } from '@jude/core/domain';
import { speakerIdentity } from '@jude/core/speakers';
import { initials } from '../format';

export const roles: Record<Role, [string, string]> = {
  judge: ['Hakim ketua', 'Presiding judge'],
  judge_member: ['Hakim anggota', 'Associate judge'],
  counsel: ['Kuasa hukum Anda', 'Your counsel'],
  opposing: ['Kuasa hukum lawan', 'Opposing counsel'],
  witness: ['Saksi', 'Witness'],
  party: ['Pihak perkara', 'Party'],
  unknown: ['Belum diketahui', 'Unidentified']
};

export function voice(speakers: Speaker[], id: string, lang: Lang) {
  const { raw, person, name } = speakerIdentity(speakers, id, lang);
  return {
    raw,
    person,
    name,
    letters: person?.label || raw?.label ? initials(name) : '?',
    role: person?.role ?? 'unknown'
  };
}

export function speakerTurns(lines: Statement[], speakers: Speaker[], lang: Lang, duration: number) {
  return lines.map((line, index) => {
    const person = voice(speakers, line.speakerId, lang);
    const end = Math.min(lines[index + 1]?.t ?? duration, duration, line.t + Math.max(5, line.text.length / 11));
    return { line, person, span: Math.max(0, end - line.t) };
  });
}

export function speakerShares(turns: ReturnType<typeof speakerTurns>) {
  const rank: Role[] = ['judge', 'judge_member', 'opposing', 'counsel', 'witness', 'party', 'unknown'];
  const totals = new Map<string, { id: string; person: ReturnType<typeof voice>; seconds: number }>();
  let total = 0;
  for (const turn of turns) {
    const key = turn.person.person?.id ?? turn.line.speakerId;
    const found = totals.get(key) ?? { id: key, person: turn.person, seconds: 0 };
    found.seconds += turn.span;
    total += turn.span;
    totals.set(key, found);
  }
  return [...totals.values()].sort((a, b) => rank.indexOf(a.person.role) - rank.indexOf(b.person.role))
    .map(({ id, person, seconds }) => ({ id, ...person, share: total ? Math.round(seconds * 100 / total) : 0 }));
}
