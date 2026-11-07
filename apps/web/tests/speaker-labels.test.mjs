import assert from 'node:assert/strict';
import test from 'node:test';
import { displaySpeaker } from '../src/lib/workspace/format.ts';

const speaker = (id, extra = {}) => ({ id, label: '', role: 'unknown', confirmed: false, ...extra });
test('different inferred voices receive distinct labels despite sharing the voice prefix', () => {
  const speakers = [speaker('voice-cluster-aa'), speaker('voice-cluster-bb')];
  assert.equal(displaySpeaker(speakers, speakers[0].id, 'id'), 'Suara 1');
  assert.equal(displaySpeaker(speakers, speakers[1].id, 'id'), 'Suara 2');
  assert.equal(displaySpeaker(speakers, speakers[1].id, 'en'), 'Voice 2');
  speakers.push(speaker('voice-cluster-cc'));
  assert.equal(displaySpeaker(speakers, speakers[0].id, 'id'), 'Suara 1');
});
test('unprocessed turns do not pretend to be detected individuals', () => {
  const speakers = [speaker('voice-pending-aa'), speaker('voice-pending-bb'), speaker('voice-cluster-cc')];
  assert.equal(displaySpeaker(speakers, 'voice-pending-aa', 'id'), 'Pembicara belum dikenali');
  assert.equal(displaySpeaker(speakers, 'voice-pending-bb', 'en'), 'Speaker not identified');
  assert.equal(displaySpeaker(speakers, 'voice-cluster-cc', 'id'), 'Suara 1');
});
test('human names and confirmed aliases take precedence over inferred labels', () => {
  const speakers = [speaker('voice-cluster-aa', { label: 'Rina', confirmed: true }), speaker('voice-cluster-bb', { alias: 'voice-cluster-aa' })];
  assert.equal(displaySpeaker(speakers, 'voice-cluster-bb', 'id'), 'Rina');
  assert.equal(displaySpeaker(speakers, 'missing', 'en'), 'Speaker not identified');
});
