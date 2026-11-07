import type { Lang, Speaker } from './domain';

function legacyVoiceNumber(id: string) {
  const match = /^v([1-9]\d{0,5})$/.exec(id);
  return match ? Number(match[1]) : undefined;
}

/** Case speakers arrive in insertion order. Pending turns have no established speaker group. */
export function numberGroupedVoices(speakers: Speaker[]) {
  const taken = new Set<number>();
  for (const speaker of speakers) {
    const number = speaker.voiceNumber ?? legacyVoiceNumber(speaker.id);
    if (number !== undefined) {
      speaker.voiceNumber = number;
      taken.add(number);
    }
  }
  let next = 1;
  for (const speaker of speakers) {
    if (speaker.voiceNumber !== undefined || !speaker.id.startsWith('voice-cluster-')) continue;
    while (taken.has(next)) next++;
    speaker.voiceNumber = next++;
  }
}

export function speakerIdentity(speakers: Speaker[], id: string, lang: Lang) {
  const raw = speakers.find(speaker => speaker.id === id);
  const person = (raw?.alias ? speakers.find(speaker => speaker.id === raw.alias) : undefined) ?? raw;
  const number = person?.voiceNumber ?? legacyVoiceNumber(person?.id ?? id);
  const unidentified = lang === 'id' ? 'Pembicara belum dikenali' : 'Unidentified speaker';
  const name = person?.displayLabel?.[lang] || person?.label || raw?.displayLabel?.[lang] || raw?.label ||
    (number === undefined ? unidentified : (lang === 'id' ? 'Suara ' : 'Voice ') + number);
  return { raw, person, name };
}
