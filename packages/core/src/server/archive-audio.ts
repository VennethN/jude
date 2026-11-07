import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import { strFromU8, strToU8 } from 'fflate';
import type { Workspace } from '../domain';
import { transaction, type Database } from './db';
import { getOriginal, putOriginal } from './providers/storage';
import { ApiError, bool, choice, invalid, number, object, string } from './validation';

const mediaTypes = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  webm: 'audio/webm',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
} as const;
type Format = keyof typeof mediaTypes;
export interface ArchivedAttachment {
  entity_id: string;
  kind: string;
  object_key: string;
  file_name: string;
  mime: string;
  byte_length: number | string;
}
type Segment = { id: string; start_seconds: number; bytes: number; object_key: string | null };
type PrivateSegment = Segment & { hearing_id: string };
interface AudioIndex {
  hearingId: string;
  recording?: { name: string; format: Format };
  turns: { id: string; time: number; bytes: number; kept: boolean }[];
}

export async function includeAudio(
  files: Record<string, Uint8Array>,
  w: Workspace,
  objects: ArchivedAttachment[],
  remaining: number,
) {
  const segments = await transaction((db) =>
    db.query<PrivateSegment>(
      'SELECT hearing_id,id,start_seconds,bytes,object_key FROM voice_turns WHERE case_id=$1 ORDER BY hearing_id,start_seconds,id',
      [w.caseRecord.id],
    ),
  );
  const index: AudioIndex[] = [];
  const charge = (bytes: number) => {
    remaining -= bytes;
    if (remaining < 0) throw new ApiError(413, 'file_too_large', 'The case is too large for one archive.');
  };
  for (const h of w.hearings) {
    const recording = objects.find((row) => row.entity_id === h.id && row.kind === 'audio');
    const turns = segments.filter((row) => row.hearing_id === h.id);
    if (!recording && !turns.length) continue;
    const entry: AudioIndex = { hearingId: h.id, turns: [] };
    if (recording) {
      const ext = extname(recording.file_name).slice(1).toLowerCase() as Format;
      const format = Object.hasOwn(mediaTypes, ext)
        ? ext
        : (Object.keys(mediaTypes) as Format[]).find((k) => mediaTypes[k] === recording.mime);
      if (!format)
        throw new ApiError(422, 'unsupported_media', 'The recording has an unsupported audio format.');
      charge(Number(recording.byte_length));
      files['audio/' + h.id + '/recording.' + format] = await getOriginal(recording.object_key);
      entry.recording = { name: basename(recording.file_name), format };
    }
    for (const turn of turns) {
      const kept = turn.object_key !== null;
      entry.turns.push({ id: turn.id, time: Number(turn.start_seconds), bytes: Number(turn.bytes), kept });
      if (turn.object_key) {
        charge(Number(turn.bytes));
        files['audio/' + h.id + '/' + turn.id + '.pcm'] = await getOriginal(turn.object_key);
      }
    }
    index.push(entry);
  }
  if (index.length) files['audio/index.json'] = strToU8(JSON.stringify(index));
}

function safeId(value: unknown) {
  const id = string(value, 'id', 120);
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) invalid('id');
  return id;
}
export async function restoreAudio(
  files: Record<string, Uint8Array>,
  w: Workspace,
  maps: Map<string, string>,
  org: string,
  attachments: ArchivedAttachment[],
  clean: Set<string>,
) {
  const entries = files['audio/index.json'] ? JSON.parse(strFromU8(files['audio/index.json'])) : [];
  if (!Array.isArray(entries) || entries.length > w.hearings.length) invalid('audio');
  const turns: PrivateSegment[] = [],
    seenHearings = new Set<string>();
  for (const raw of entries) {
    const entry = object(raw, 'audio'),
      old = safeId(entry.hearingId),
      h = w.hearings.find((h) => h.id === maps.get(old));
    if (!h || seenHearings.has(old)) invalid('hearingId');
    seenHearings.add(old);
    let audible = false;
    const archiveDir = 'audio/' + old + '/',
      prefix = org + '/' + w.caseRecord.id + '/' + h.id + '/';
    if (entry.recording) {
      const recording = object(entry.recording, 'recording'),
        format = choice(recording.format, Object.keys(mediaTypes) as Format[], 'format');
      const bytes = files[archiveDir + 'recording.' + format];
      if (!bytes?.length) invalid('audio');
      const name = basename(string(recording.name, 'file_name', 200)).replace(/[\x00-\x1f\x7f]/g, ' ');
      const mime = mediaTypes[format],
        key = prefix + 'audio';
      attachments.push({
        entity_id: h.id,
        kind: 'audio',
        object_key: key,
        file_name: name,
        mime,
        byte_length: bytes.byteLength,
      });
      clean.add(key);
      await putOriginal(key, bytes, mime);
      audible = true;
    }
    if (!Array.isArray(entry.turns) || entry.turns.length > 12000) invalid('turns');
    const seen = new Set<string>();
    for (const rawTurn of entry.turns) {
      const t = object(rawTurn, 'turn'),
        oldTurn = safeId(t.id);
      if (seen.has(oldTurn)) invalid('turn');
      seen.add(oldTurn);
      const length = number(t.bytes, 'bytes', 2, 2_000_000),
        time = number(t.time, 'time', 0, 7 * 86400);
      if (!Number.isInteger(length) || length % 2) invalid('bytes');
      const id = randomUUID();
      let key: string | null = null;
      if (bool(t.kept, 'kept')) {
        const data = files[archiveDir + oldTurn + '.pcm'];
        if (!data || data.byteLength !== length) invalid('audio');
        key = prefix + id + '.pcm';
        clean.add(key);
        await putOriginal(key, data, 'application/octet-stream');
        audible = true;
      }
      turns.push({ id, hearing_id: h.id, start_seconds: time, bytes: length, object_key: key });
    }
    if (audible) h.audio = '/api/live/' + w.caseRecord.id + '/' + h.id + '/audio';
  }
  return turns;
}
export async function insertArchivedTurns(db: Database, caseId: string, turns: PrivateSegment[]) {
  for (const t of turns)
    await db.query(
      'INSERT INTO voice_turns(case_id,hearing_id,id,start_seconds,bytes,object_key) VALUES($1,$2,$3,$4,$5,$6)',
      [caseId, t.hearing_id, t.id, t.start_seconds, t.bytes, t.object_key],
    );
}
