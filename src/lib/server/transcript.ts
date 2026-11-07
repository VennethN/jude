import { extname } from 'node:path';
import { readDocument } from './documents';
import { ApiError, invalid, number, object, string } from './validation';

type Turn = { speaker: string; time: number; text: string };
function offset(value: string) {
  const pieces = value.replace(',', '.').split(':').map(Number);
  return pieces.reduce((n, v) => n * 60 + v, 0);
}
function textTurns(text: string): Turn[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((line, index) => {
      const match = /^(?:\[?(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]?\s*)?(?:([^:\n]{1,100}):\s*)?(.+)$/.exec(
        line.trim(),
      );
      return {
        speaker: match?.[2]?.trim() || 'Suara 1',
        time: match?.[1] ? offset(match[1]) : index * 5,
        text: match?.[3]?.trim() || line.trim(),
      };
    });
}
function captions(text: string): Turn[] {
  const output: Turn[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = block.split('\n'),
      timeIndex = lines.findIndex((l) => l.includes('-->'));
    if (timeIndex === -1) continue;
    const raw = lines.slice(timeIndex + 1).join(' '),
      voice = raw.match(/^<v(?:\.[\w-]+)?\s+([^>]+)>/);
    const spoken = raw.replace(/<[^>]+>/g, '').trim();
    const named = voice ? undefined : /^([^:\n]{1,100}):\s*(.+)$/.exec(spoken);
    if (spoken)
      output.push({
        speaker: voice?.[1] ?? named?.[1] ?? 'Suara 1',
        time: offset(lines[timeIndex].split('-->')[0].trim()),
        text: named?.[2] ?? spoken,
      });
  }
  return output;
}
function csv(text: string) {
  const table: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' && !quoted) {
      row.push(cell);
      table.push(row);
      row = [];
      cell = '';
    } else if (c !== '\r') cell += c;
  }
  if (quoted) invalid('file');
  if (row.length || cell) {
    row.push(cell);
    table.push(row);
  }
  const header = table.shift()?.map((v) => v.toLowerCase().trim());
  if (!header || !header.includes('text')) invalid('file');
  return table
    .filter((cells) => cells.some(Boolean))
    .map((cells, i) => ({
      speaker: cells[header.indexOf('speaker')] || 'Suara 1',
      text: cells[header.indexOf('text')],
      time: offset(cells[header.indexOf('time')] || String(i * 5)),
    }));
}
export async function previewTranscript(form: FormData) {
  const f = form.get('file');
  if (!(f instanceof File) || !f.size || f.size > 6 * 1024 * 1024) invalid('file');
  const ext = extname(f.name).toLowerCase();
  const title = f.name.slice(0, -ext.length).slice(0, 160);
  let turns: Turn[];
  try {
    if (ext === '.pdf' || ext === '.docx') {
      const material = await readDocument(
        new Uint8Array(await f.arrayBuffer()),
        ext === '.pdf' ? 'PDF' : 'DOCX',
      );
      turns = textTurns(material.pages.map((p) => p.text).join('\n'));
    } else {
      const text = await f.text();
      if (ext === '.json' || ext === '.jude') {
        const data = JSON.parse(text),
          rows = Array.isArray(data) ? data : data.turns;
        if (!Array.isArray(rows)) invalid('file');
        turns = rows.map((r, i) => {
          const line = object(r, 'turn');
          return {
            speaker: string(line.speaker || 'Suara 1', 'speaker', 180),
            time: number(line.time ?? i * 5, 'time', 0, 7 * 86400),
            text: string(line.text, 'text', 30000),
          };
        });
      } else if (ext === '.csv') turns = csv(text);
      else if (ext === '.srt' || ext === '.vtt') turns = captions(text);
      else if (ext === '.txt') turns = textTurns(text);
      else invalid('file');
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    invalid('file');
  }
  if (
    !turns.length ||
    turns.length > 5000 ||
    turns.some(
      (t) =>
        !Number.isFinite(t.time) ||
        t.time < 0 ||
        t.time > 7 * 86400 ||
        !t.text?.trim() ||
        t.text.length > 30000,
    )
  )
    invalid('file');
  return {
    title,
    date: new Date().toISOString().slice(0, 10),
    turns,
    speakers: [...new Set(turns.map((t) => t.speaker))].map((name) => ({ name })),
  };
}
