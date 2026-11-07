import { around, sources, type LandingRecord } from './landing-record';
import type { Lang } from '@jude/core/domain';

type SourceKey = (typeof sources)[number]['key'] | 'statement' | 'shift';

/** Keep the highlighted phrase and its surrounding clause on the small evidence slips. */
export function deskQuote(key: SourceKey, record: LandingRecord, lang: Lang): [string, string, string] {
  if (key === 'statement') {
    const parts = around(record.testimony, sources[0].mark[lang]);
    return parts[1] ? ['…', parts[1], '…'] : parts;
  }
  if (key === 'shift') {
    const end = record.shift.indexOf('. ');
    return [end >= 0 ? record.shift.slice(0, end + 1) + '…' : record.shift, '', ''];
  }
  const source = sources.find((item) => item.key === key)!;
  const parts = around(record[key], source.mark[lang]);
  if (key === 'gate' && parts[1]) {
    const words = parts[0].trimEnd().split(/\s+/);
    return [words.length > 6 ? '…' + words.slice(-6).join(' ') + ' ' : parts[0], parts[1], parts[2]];
  }
  if (key !== 'written' || !parts[1]) return parts;
  const [before, mark, after] = parts;
  const words = before.trimEnd().split(/\s+/);
  const lead = words.length > 4 ? '…' + words.slice(-4).join(' ') + ' ' : before;
  const clauseEnd = after.indexOf(',');
  return [lead, mark, clauseEnd >= 0 ? after.slice(0, clauseEnd) + '…' : after];
}
