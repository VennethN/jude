import { randomUUID } from 'node:crypto';
import type { Hearing, Role, Workspace } from '../domain';
import {
  ApiError,
  bilingual,
  bool,
  choice,
  date,
  invalid,
  number,
  object,
  required,
  string,
  type Fields,
} from './validation';

const roles: Role[] = ['judge', 'judge_member', 'counsel', 'opposing', 'witness', 'party', 'unknown'];
function hearingTime(value: unknown) {
  const t = string(value, 'time', 5, true);
  if (t && !/^([01]\d|2[0-3])[:.][0-5]\d$/.test(t)) invalid('time');
  return t;
}
export function addHearing(w: Workspace, fields: Fields, userId: string, practice = false) {
  const flow = choice(fields.flow ?? 'schedule', ['schedule', 'live', 'import'], 'flow');
  const h: Hearing = {
    id: randomUUID(),
    caseId: w.caseRecord.id,
    number: Math.max(0, ...w.hearings.map((h) => h.number)) + 1,
    title: bilingual(fields.title, 'title'),
    date: date(fields.date),
    time: hearingTime(fields.time),
    mode: flow === 'import' ? 'imported' : 'scheduled',
    closed: fields.closed === undefined ? false : bool(fields.closed, 'closed'),
  };
  w.hearings.push(h);
  if (flow === 'live') return startHearing(w, h.id, fields, userId, practice);
  return h;
}
export function startHearing(w: Workspace, id: string, fields: Fields, userId: string, practice = false) {
  const h = required(w.hearings, (h) => h.id === id);
  if (h.closed || fields.closed === true || fields.recordingPermission !== true)
    throw new ApiError(
      422,
      'recording_permission',
      'Recording requires judicial permission in an open hearing.',
    );
  if (h.mode !== 'scheduled' || w.hearings.some((other) => other.mode === 'live'))
    throw new ApiError(409, 'already_recording', 'A hearing is already live.');
  h.language = choice(fields.language ?? h.language ?? 'id', ['id', 'en'] as const, 'language');
  h.mode = 'live';
  h.startedAt = new Date().toISOString();
  h.recordingPermission = {
    at: h.startedAt,
    by: userId,
    text: practice
      ? 'I consent to have my voice transcribed for this practice hearing.'
      : 'I confirm the presiding judge permitted recording in this open hearing.',
  };
  return h;
}
export function endHearing(w: Workspace, id: string) {
  const h = required(w.hearings, (h) => h.id === id);
  if (h.mode === 'recorded') return h;
  if (h.mode !== 'live') throw new ApiError(409, 'conflict', 'This hearing is not live.');
  const lastLine = w.statements.reduce((max, s) => (s.hearingId === id ? Math.max(max, s.t) : max), 0);
  h.mode = 'recorded';
  h.endedAt = new Date().toISOString();
  h.duration = Math.max(
    lastLine,
    h.startedAt ? Math.floor((Date.now() - Date.parse(h.startedAt)) / 1000) : 0,
  );
  return h;
}
export function patchHearing(w: Workspace, id: string, fields: Fields) {
  const h = required(w.hearings, (h) => h.id === id);
  if ('title' in fields) h.title = bilingual(fields.title, 'title');
  if ('date' in fields) h.date = date(fields.date);
  if ('time' in fields) h.time = hearingTime(fields.time);
  return h;
}
export function importHearing(w: Workspace, fields: Fields, userId: string) {
  if (!Array.isArray(fields.turns) || !fields.turns.length || fields.turns.length > 5000) invalid('turns');
  const h = addHearing(w, { ...fields, flow: 'import' }, userId);
  const mapping = fields.mapping ? object(fields.mapping, 'mapping') : {};
  let end = 0;
  for (const [index, raw] of fields.turns.entries()) {
    const turn = object(raw, 'turns'),
      label = string(turn.speaker || 'Suara 1', 'speaker', 180),
      text = string(turn.text, 'text', 30000);
    const t = number(turn.time ?? turn.t ?? index * 5, 'time', 0, 7 * 86400);
    if (t < end) invalid('time');
    end = t;
    const mapped = mapping[label];
    let speaker = mapped
      ? required(w.speakers, (s) => s.id === mapped)
      : w.speakers.find((s) => s.label.toLocaleLowerCase() === label.toLocaleLowerCase());
    if (!speaker) {
      speaker = { id: randomUUID(), label, role: 'unknown', confirmed: false };
      w.speakers.push(speaker);
    }
    w.statements.push({ id: randomUUID(), t, text, hearingId: h.id, speakerId: speaker.id, phase: 'saved' });
  }
  h.duration = end;
  return h;
}
export function patchSpeaker(w: Workspace, id: string, fields: Fields) {
  const speaker = required(w.speakers, (s) => s.id === id);
  if ('alias' in fields || 'aliasId' in fields) {
    const alias = fields.alias ?? fields.aliasId;
    if (!alias) delete speaker.alias;
    else {
      const other = required(w.speakers, (s) => s.id === alias);
      if (other.alias || other.id === speaker.id || w.speakers.some((s) => s.alias === speaker.id))
        invalid('alias');
      speaker.alias = other.id;
    }
  }
  if ('label' in fields) speaker.label = string(fields.label, 'label', 160, true);
  if ('role' in fields) speaker.role = choice(fields.role, roles, 'role');
  speaker.confirmed = fields.confirmed === undefined ? true : bool(fields.confirmed, 'confirmed');
  return speaker;
}
