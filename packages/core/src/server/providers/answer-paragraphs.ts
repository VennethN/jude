import type { ChatMessage, Citation } from '../../domain';
import type { Source } from './assistant';
import { objectSchema, safeLanguage, str } from './openai';

interface Proof { evidence: number; quote: string }
export interface AnswerParagraph { summary: string; citations: Proof[] }
const proof = objectSchema({ evidence: {type:'integer'}, quote:str });
// Structured Outputs preserves key order, so proofs arrive before any visible prose.
const paragraph = objectSchema({ citations:{type:'array',items:proof}, summary:str });
export const answerSchema = objectSchema({paragraphs:{type:'array',items:paragraph}});

export function checkedParagraph(value: unknown, sources: Source[]): value is AnswerParagraph {
  if (!value || typeof value !== 'object') return false;
  const { summary, citations } = value as Partial<AnswerParagraph>;
  return typeof summary === 'string' && summary.trim().length > 0 && summary.length <= 1200 &&
    safeLanguage(summary) && !/[“”"\[\]]/.test(summary) && Array.isArray(citations) &&
    citations.length > 0 && citations.length <= 8 && citations.every(c =>
      c && Number.isInteger(c.evidence) && typeof c.quote === 'string' && c.quote.trim().length >= 4 &&
      c.quote.length <= 650 && sources[c.evidence-1]?.text.includes(c.quote));
}

export function composeAnswer(id:string, paragraphs:AnswerParagraph[], sources:Source[], writing = false):ChatMessage {
  const citations:Citation[] = [];
  const text = paragraphs.map((p, index) => {
    const numbers = new Set<number>();
    for (const ref of p.citations) {
      const source = sources[ref.evidence-1];
      let index = citations.findIndex(c=>c.kind===source.kind && c.id===source.id);
      if (index < 0) { index=citations.length; citations.push({kind:source.kind,id:source.id}); }
      numbers.add(index + 1);
    }
    if (writing && index === paragraphs.length - 1) return p.summary.trim();
    return p.summary.trim() + ' ' + [...numbers].map(n=>'['+n+']').join(' ');
  }).join('\n\n');
  return { id, role:'assistant', mode:'ai', text, citations };
}

/** Decode complete paragraphs and text prefixes that follow a fully received proof list. */
export function readParagraphs(onParagraph: (value: unknown) => void, onText?: (value: unknown) => void) {
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
    // At this depth, closing the string and object can only yield a usable prefix
    // once all nested citations are already complete. A split escape waits for the next delta.
    if (!onText || depth !== 2 || !quoted || escaped) return;
    let part: Partial<AnswerParagraph>;
    try { part = JSON.parse(fragment + '"}'); } catch { return; }
    if (!Array.isArray(part.citations) || typeof part.summary !== 'string') return;
    const boundary = part.summary.search(/\s+\S*$/u);
    if (boundary < previewLength + 12) return;
    previewLength = boundary;
    onText({ citations:part.citations, summary:part.summary.slice(0, boundary) });
  };
}
