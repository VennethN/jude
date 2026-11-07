import type { ChatMessage, Citation, L10n, Lang } from '../../domain';
import type { Source } from './assistant';
import { objectSchema, safeLanguage, str } from './openai';

interface Proof { evidence: number; quote: string }
export interface AnswerParagraph { summary: L10n; citations: Proof[] }
const proof = objectSchema({ evidence: {type:'integer'}, quote:str });

export function answerSchema(lang: Lang) {
  // Structured Outputs preserves key order. Verify the proofs, then stream the requested language first.
  const summary = objectSchema(lang === 'id' ? { id: str, en: str } : { en: str, id: str });
  const paragraph = objectSchema({ citations: { type: 'array', items: proof }, summary });
  return objectSchema({ paragraphs: { type: 'array', items: paragraph } });
}

export function checkedParagraph(value: unknown, sources: Source[], previewLang?: Lang): value is AnswerParagraph {
  if (!value || typeof value !== 'object') return false;
  const { summary, citations } = value as Partial<AnswerParagraph>;
  if (!summary || typeof summary !== 'object') return false;
  return (['id', 'en'] as const).every(lang => {
    const text = summary[lang];
    if (previewLang && lang !== previewLang && text === '') return true;
    return typeof text === 'string' && text.trim().length > 0 && text.length <= 1200 &&
      safeLanguage(text) && !/[“”"\[\]]/.test(text);
  }) && Array.isArray(citations) && citations.length > 0 && citations.length <= 8 && citations.every(c =>
    c && Number.isInteger(c.evidence) && typeof c.quote === 'string' && c.quote.trim().length >= 4 &&
    c.quote.length <= 650 && sources[c.evidence-1]?.text.includes(c.quote));
}

export function composeAnswer(id: string, paragraphs: AnswerParagraph[], sources: Source[], writing = false): ChatMessage {
  const citations: Citation[] = [];
  const lines: Record<Lang, string[]> = { id: [], en: [] };
  for (const [index, paragraph] of paragraphs.entries()) {
    const numbers = new Set<number>();
    for (const ref of paragraph.citations) {
      const source = sources[ref.evidence - 1];
      let position = citations.findIndex(c => c.kind === source.kind && c.id === source.id);
      if (position < 0) {
        position = citations.length;
        citations.push({ kind: source.kind, id: source.id });
      }
      numbers.add(position + 1);
    }
    const suffix = writing && index === paragraphs.length - 1 ? '' : ' ' + [...numbers].map(n => '[' + n + ']').join(' ');
    for (const lang of ['id', 'en'] as const) {
      const summary = paragraph.summary[lang].trim();
      if (summary) lines[lang].push(summary + suffix);
    }
  }
  return { id, role: 'assistant', mode: 'ai', text: { id: lines.id.join('\n\n'), en: lines.en.join('\n\n') }, citations };
}

/** Decode complete paragraphs and the requested language's text after its proof list. */
export function readParagraphs(lang: Lang, onParagraph: (value: unknown) => void, onText?: (value: unknown) => void) {
  let depth = 0, quoted = false, escaped = false, fragment = '', previewLength = 0;
  return (delta: string) => {
    for (const ch of delta) {
      if (depth >= 2) fragment += ch;
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === '{') {
        if (++depth === 2) {
          fragment = '{';
          previewLength = 0;
        }
      } else if (ch === '}' && --depth === 1) {
        let value: unknown;
        try { value = JSON.parse(fragment); } catch { continue; }
        onParagraph(value);
      }
    }
    if (!onText || depth !== 3 || !quoted || escaped) return;
    let part: Partial<AnswerParagraph>;
    try { part = JSON.parse(fragment + '"}}'); } catch { return; }
    const text = part.summary?.[lang];
    if (!Array.isArray(part.citations) || typeof text !== 'string') return;
    const other = lang === 'id' ? 'en' : 'id';
    const boundary = typeof part.summary?.[other] === 'string' ? text.length : text.search(/\s+\S*$/u);
    if (boundary < previewLength + 12) return;
    previewLength = boundary;
    onText({ citations: part.citations, summary: { id: '', en: '', [lang]: text.slice(0, boundary) } });
  };
}
