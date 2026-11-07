import type { Lang, Role, Speaker } from '@jude/core/domain';
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
  const raw = speakers.find((s) => s.id === id);
  const person = (raw?.alias && speakers.find((s) => s.id === raw.alias)) || raw;
  const name =
    person?.label || (lang === 'id' ? 'Suara ' : 'Voice ') + (id.match(/^v(\d+)$/)?.[1] ?? id.slice(0, 4));
  return {
    raw,
    person,
    name,
    letters: person?.label ? initials(name) : '?',
    role: person?.role ?? 'unknown'
  };
}
