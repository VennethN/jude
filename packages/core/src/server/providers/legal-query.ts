export interface PublicLawSearch {
  q: string;
  article: string;
  numbered?: { type: string; number: string; year: string };
  code?: string;
  type?: string;
  topic?: string;
}

const constitution = /\b(?:uud(?:\s+(?:nri|ri))?|undang[-\s]+undang\s+dasar|konstitusi|constitutions?|constitutional)\b/i;
const statute = /\b(?:uu|undang[-\s]+undang|statutes?|acts? of parliament)\b/i;
const legalSubject = /\b(?:laws?|statutes?|legislation|regulations?|legal (?:basis|provision|reference)|articles?|dasar hukum|hukum|peraturan|aturan|pasal)\b/i;
const lookup = /\b(?:what|which|find|search|show|give|relevant|appl(?:ies|icable|y)|governs?|cited|apa(?:kah)?|mana|berapa|cari(?:kan)?|sebutkan|tunjukkan|relevan|berlaku|mengatur|dasar hukum|rujukan)\b/i;
const charterArticle = /\b(?:pasal|article)\s+(\d{1,4}[a-z]?)\b/i;
const numberedLaw = /\b(UU|PP|PERPPU|PERPRES|PERMA|PERDA|KEPPRES|POJK|undang[-\s]+undang|(?:indonesian\s+)?law|government regulation)\s*(?:RI\s*)?(?:(?:no\.?|nomor|number)\s*)?(\d{1,4})\s*(?:tahun\s*|\/\s*|of\s+)((?:19|20)\d{2})\b/i;
const code = /\b(?:KUHAP|KUHP|KUHPerdata|KUHD)\b/i;

const constitutionalTopics = new Set(['hak atas pendidikan', 'hak atas pekerjaan', 'kebebasan beragama', 'persamaan di hadapan hukum']);
export const constitutionalTopic = (term: PublicLawSearch) => !!term.topic && constitutionalTopics.has(term.topic);

export function sentencingTopic(text: string) {
  const aggravating = /\b(?:memberatkan|memperberat|pemberat(?:an)?|aggravat(?:e|es|ed|ing|ion)|harsher sentence)\b/i.test(text);
  const mitigating = /\b(?:meringankan|memperingan|peringan(?:an)?|mitigat(?:e|es|ed|ing|ion)|lighter sentence)\b/i.test(text);
  if (aggravating && mitigating) return 'pedoman pemidanaan';
  if (aggravating) return 'pemberatan pidana';
  if (mitigating) return 'peringanan pidana';
}

const vocabulary: [RegExp, string][] = [
  [/\b(?:penggelapan|embezzlement)\b/i, 'penggelapan'],
  [/\b(?:alat bukti|admissibility|evidence law)\b/i, 'alat bukti'],
  [/\b(?:keterangan saksi|witness testimony|testimony of witnesses)\b/i, 'keterangan saksi'],
  [/\b(?:perekaman sidang|rekaman sidang|courtroom recording)\b/i, 'perekaman sidang'],
  [/\b(?:ketenagakerjaan|employment(?: law)?|hubungan (?:kerja|industrial)|pemutusan hubungan kerja)\b/i, 'ketenagakerjaan'],
  [/\b(?:perlindungan konsumen|consumer protection)\b/i, 'perlindungan konsumen'],
  [/\b(?:perlindungan data pribadi|personal data protection)\b/i, 'perlindungan data pribadi'],
  [/\b(?:hak atas pendidikan|right to education)\b/i, 'hak atas pendidikan'],
  [/\b(?:hak atas pekerjaan|right to work)\b/i, 'hak atas pekerjaan'],
  [/\b(?:kebebasan beragama|freedom of religion)\b/i, 'kebebasan beragama'],
  [/\b(?:persamaan di (?:muka|hadapan) hukum|equality before the law)\b/i, 'persamaan di hadapan hukum'],
  [/\b(?:perjanjian|kontrak|contract(?:s| law)?)\b/i, 'perjanjian'],
  [/\b(?:sengketa tanah|land disputes?)\b/i, 'sengketa tanah'],
  [/\b(?:penipuan|fraud)\b/i, 'penipuan'],
  [/\b(?:pencurian|theft)\b/i, 'pencurian'],
];

export const lawCategory = (text: string) => constitution.test(text) ? 'UUD' : statute.test(text) ? 'UU' : undefined;
export const isLawQuestion = (text: string) => constitution.test(text) ||
  ((lookup.test(text) || /^(?:\s*(?:pasal|article|uu|undang[-\s]+undang|kuh(?:ap|p|perdata|d)|pp|perppu|perpres|perma|perda)\b)/i.test(text)) &&
    (legalSubject.test(text) || statute.test(text) || code.test(text) || numberedLaw.test(text)));

/** Rebuild queries from public identifiers or a fixed vocabulary. Never forward free-form input. */
export function publicLawTerms(input: string, explicitOnly = false): PublicLawSearch | undefined {
  const article = input.match(charterArticle)?.[1]?.toUpperCase() ?? '';
  const prefix = article ? 'Pasal ' + article + ' ' : '';
  const subject = explicitOnly ? undefined : vocabulary.find(([pattern]) => pattern.test(input))?.[1];
  if (constitution.test(input)) {
    if (!article && subject && constitutionalTopics.has(subject)) return { q: subject, topic: subject, article, type: 'UUD' };
    return { q: prefix + 'UUD 1945', article, type: 'UUD' };
  }
  const numbered = input.match(numberedLaw);
  if (numbered) {
    const acronym = numbered[1].toUpperCase();
    const type = /UNDANG|LAW/.test(acronym) ? 'UU' : acronym === 'GOVERNMENT REGULATION' ? 'PP' : acronym;
    const law = { type, number: numbered[2], year: numbered[3] };
    return { q: prefix + type + ' Nomor ' + law.number + ' Tahun ' + law.year, article, numbered: law };
  }
  const name = input.match(code)?.[0]?.toUpperCase();
  if (name) return { q: prefix + name, article, code: name };
  if (article) return { q: prefix.trim(), article };
  if (explicitOnly) return;
  if (subject) return { q: subject, topic: subject, article: '', ...(statute.test(input) ? { type: 'UU' } : {}) };
}
