// Jude interprets a small set of text formatting. Only a verified case-source number can become a link.
export type Inline =
  | { kind: 'text' | 'quote'; text: string }
  | { kind: 'citation'; number: number; text: string }
  | { kind: 'strong' | 'em'; children: Inline[] };

export type Block =
  | { kind: 'paragraph' | 'heading' | 'subheading'; content: Inline[] }
  | { kind: 'ordered' | 'bullets'; items: Inline[][]; start: number };

const word = /[\p{L}\p{N}]/u;
const quoteOrBreak = /(“[^”]*(?:”|$)|"[^"\n]*(?:"|$)|\r?\n)/;
const inlineTokens = /“[^”]*(?:”|$)|"[^"\n]*(?:"|$)|!?\[[^\[\]\n]*\]\([^\s)]*\)|\\[\\*_#\[\]]|\[\d+\]|\*+|_+/g;

function styled(marker: string, children: Inline[]): Inline {
  if (marker.length === 3) return { kind: 'strong', children: [{ kind: 'em', children }] };
  return { kind: marker.length === 2 ? 'strong' : 'em', children };
}

export function inlines(text: string, markdown = false, streaming = false): Inline[] {
  const root: Inline[] = [];
  const stack: { marker: string; content: Inline[] }[] = [{ marker: '', content: root }];
  const current = () => stack[stack.length - 1].content;
  let from = 0;
  for (const match of text.matchAll(inlineTokens)) {
    const at = match.index, token = match[0];
    if (at > from) current().push({ kind: 'text', text: text.slice(from, at) });
    from = at + token.length;
    if (token[0] === '“' || token[0] === '"') {
      current().push({ kind: 'quote', text: token });
    } else if (/^\[\d+\]$/.test(token)) {
      current().push({ kind: 'citation', number: Number(token.slice(1, -1)), text: token });
    } else if (markdown && (token[0] === '*' || token[0] === '_') && token.length <= 3) {
      const left = text[at - 1] ?? '', right = text[from] ?? '';
      const insideWord = token[0] === '_' && word.test(left) && word.test(right);
      if (!insideWord && left && !/\s/.test(left) && stack.at(-1)?.marker === token) {
        const open = stack.pop()!;
        current().push(styled(token, open.content));
      } else if (!insideWord && right && !/\s/.test(right)) {
        stack.push({ marker: token, content: [] });
      } else {
        current().push({ kind: 'text', text: token });
      }
    } else {
      current().push({ kind: 'text', text: markdown && token[0] === '\\' ? token.slice(1) : token });
    }
  }
  if (from < text.length) current().push({ kind: 'text', text: text.slice(from) });
  while (stack.length > 1) {
    const open = stack.pop()!;
    if (streaming) current().push(styled(open.marker, open.content));
    else current().push({ kind: 'text', text: open.marker }, ...open.content);
  }
  return root;
}

export function answerBlocks(text: string, streaming = false): Block[] {
  // A quotation can contain its own line breaks, Markdown punctuation and bracketed numbers.
  const lines = [''];
  for (const piece of text.split(quoteOrBreak)) {
    if (piece === '\n' || piece === '\r\n') lines.push('');
    else lines[lines.length - 1] += piece;
  }
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const parse = (value: string) => inlines(value, true, streaming);
  function flush() {
    if (paragraph.length) blocks.push({ kind: 'paragraph', content: parse(paragraph.join('\n')) });
    paragraph = [];
  }
  for (const line of lines) {
    if (!line.trim()) { flush(); continue; }
    const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:\s+#+)?$/s.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: heading[1].length <= 2 ? 'heading' : 'subheading', content: parse(heading[2]) });
      continue;
    }
    const item = /^ {0,3}(?:[-+*]|(\d{1,9})[.)])[ \t]+(.+)$/s.exec(line);
    if (item) {
      flush();
      const kind = item[1] ? 'ordered' : 'bullets';
      const last = blocks.at(-1);
      if (last?.kind === kind) last.items.push(parse(item[2]));
      else blocks.push({ kind, items: [parse(item[2])], start: Number(item[1] ?? 1) });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}
