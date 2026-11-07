import type { L10n, Lang, Finding, Speaker } from '$lib/domain';

export function localized(value: string | L10n | null | undefined, lang: Lang) {
  return typeof value === 'string' ? value : value?.[lang] ?? '';
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
  const s = speakers.find(s => s.id === id);
  const assigned = s?.alias ? speakers.find(a=>a.id===s.alias) : undefined;
  return assigned?.label || s?.label || (lang==='id'?'Suara ':'Voice ') + id.replace(/^v/,'');
}
export function initials(name: string) {
  return name.replace(/^(Saksi|Terdakwa) /i, '').split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase();
}
