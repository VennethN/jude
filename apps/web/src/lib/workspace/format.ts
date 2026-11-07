import type { L10n, Lang, Finding, Speaker } from '@jude/core/domain';
import { speakerIdentity } from '@jude/core/speakers';

export function localized(value: string | L10n | null | undefined, lang: Lang) {
  return typeof value === 'string' ? value : value?.[lang] ?? '';
}
export function displayTitle(record: { title: string; displayTitle?: L10n } | undefined, lang: Lang) {
  return record?.displayTitle?.[lang] ?? record?.title ?? '';
}
export function displayCourt(record: { court: string; displayCourt?: L10n }, lang: Lang) {
  return record.displayCourt?.[lang] ?? record.court;
}
export function findingQuestion(finding: Finding, lang: Lang) {
  return finding.questionTranslation?.[lang] ?? finding.question;
}
export function formatDate(value: string, lang: Lang, short = false) {
  const date = new Date(value.length === 10 ? value + 'T00:00:00+07:00' : value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(lang === 'id' ? 'id-ID' : 'en-GB', { day:'numeric', month:short ? 'short' : 'long', year:'numeric', timeZone:'Asia/Jakarta' }).format(date);
}
export function timecode(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s/3600), Math.floor(s/60)%60, s%60].map(v=>String(v).padStart(2,'0')).join(':');
}
export const needsLook = (f: Finding) => !f.reviewed && (f.status === 'potential_inconsistency' || f.status === 'context_needed');
export function displaySpeaker(speakers: Speaker[], id: string, lang: Lang) {
  return speakerIdentity(speakers, id, lang).name;
}
export function initials(name: string) {
  return name.replace(/^(Saksi|Terdakwa|Witness|Defendant) /i, '').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
}
