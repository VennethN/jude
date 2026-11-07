import { expect, test } from 'vitest';
import type { Speaker } from '../src/domain';
import { numberGroupedVoices, speakerIdentity } from '../src/speakers';

const unnamed = (id: string): Speaker => ({ id, label: '', role: 'unknown', confirmed: false });

test('pending turns stay unidentified and grouped voices retain their number after one is named', () => {
  const first = unnamed('voice-cluster-6ac507d2');
  const second = unnamed('voice-cluster-4ac65bde');
  const pending = unnamed('voice-pending-753c051b');
  const speakers = [first, pending, second, unnamed('v2')];
  numberGroupedVoices(speakers);
  expect(speakerIdentity(speakers, first.id, 'en').name).toBe('Voice 1');
  expect(speakerIdentity(speakers, 'v2', 'id').name).toBe('Suara 2');
  expect(speakerIdentity(speakers, second.id, 'id').name).toBe('Suara 3');
  for (const id of [pending.id, 'voice-old-hearing-1', 'bd2dd761-03da-473d-9016-c307cda93279']) {
    expect(speakerIdentity(speakers, id, 'id').name).toBe('Pembicara belum dikenali');
    expect(speakerIdentity(speakers, id, 'en').name).toBe('Unidentified speaker');
  }
  first.label = 'Saksi Rina';
  pending.alias = first.id;
  numberGroupedVoices(speakers);
  expect(speakerIdentity(speakers, pending.id, 'id')).toMatchObject({ raw: pending, person: first, name: 'Saksi Rina' });
  expect(speakerIdentity(speakers, second.id, 'en').name).toBe('Voice 3');
});
