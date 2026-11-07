// Run with Node 22.13+ after editing the fictional warehouse exhibits or transcript.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { strToU8, zipSync } from 'fflate';
import * as record from '../src/server/seed.ts';

const assets = new URL('../../../apps/web/static/demo/documents/', import.meta.url);
const destination = new URL('../src/server/data/', import.meta.url);
const caseId = 'c1';
const historical = record.cases.find(item => item.id === caseId);
const caseRecord = {
  ...historical,
  summary: {
    id: 'Berkas latihan fiktif. ' + historical.summary.id,
    en: 'Fictional practice case. ' + historical.summary.en,
  },
};
const hearings = record.hearings.filter(item => item.caseId === caseId).map(item => {
  if (item.mode !== 'live') return item;
  const last = Math.max(0, ...record.statements.filter(line => line.hearingId === item.id).map(s => s.t));
  return { ...item, mode: 'recorded', duration: last + 5 };
});
const documents = record.documents.filter(doc => doc.caseId === caseId).map(({ pdf, ...doc }) => doc);
const passages = record.passages.filter(p => documents.some(d => d.id === p.docId));
const exhibits = [
  {
    id: 'd8', title: 'Catatan verifikasi Gerbang Timur / East Gate verification',
    kind: {id: 'Catatan petugas gerbang', en: 'Gate officer’s record'},
    idText: 'Pada 14 Maret 2026 pukul 20:07:41 WIB, saya memeriksa kartu dan identitas Rina Hartati, lalu melihat Rina Hartati melewati Gerbang Timur untuk masuk ke Gudang B. Terminal mencatat waktu dalam WIB.',
    enText: 'On 14 March 2026 at 20:07:41 WIB, I checked Rina Hartati’s access card and identity and saw Rina Hartati enter Warehouse B through the East Gate. The terminal recorded local time (WIB).',
    signer: 'Petugas Gerbang Timur / East Gate officer: Maya Ardi',
  },
  {
    id: 'd9', title: 'Klarifikasi Rina Hartati / Witness clarification',
    kind: {id: 'Keterangan tertulis saksi', en: 'Written witness statement'},
    idText: 'Pada 14 Maret 2026 saya pertama kali masuk pukul 21.30 WIB. Maksud saya Gerbang Timur Gudang B. Saya belum melewati gerbang itu sebelum pukul 21.30 pada malam tersebut.',
    enText: 'On 14 March 2026, I first entered at 21:30 WIB. I mean the East Gate of Warehouse B. I did not pass through that gate before 21:30 that evening.',
    signer: 'Saksi / Witness: Rina Hartati',
  },
];
const files = {};
for (const doc of documents) {
  const base = 'documents/' + doc.id + '/';
  if (doc.file === 'DOCX') {
    files[base + 'original.docx'] = await readFile(new URL(doc.id + '.docx', assets));
    files[base + 'viewer.pdf'] = await readFile(new URL(doc.id + '.pdf', assets));
  } else {
    files[base + 'original.pdf'] = await readFile(new URL(doc.id + '.pdf', assets));
  }
}
for (const exhibit of exhibits) {
  const {id, title, kind, idText, enText, signer} = exhibit;
  const original = strToU8([
    'BERKAS LATIHAN FIKTIF JUDE / FICTIONAL JUDE TRAINING EXHIBIT',
    title, '', idText, '', 'English translation:', enText, '', signer, '',
  ].join('\n'));
  files['documents/' + id + '/original.txt'] = original;
  documents.push({ id, caseId, title, kind, pages: 1, file: 'TXT', size: original.length + ' B', added: '2026-11-04' });
  passages.push({ id: id + 'p1', docId: id, page: 1, text: idText }, { id: id + 'p2', docId: id, page: 1, text: enText });
}
const prompts = [
  ['th-differences', 'Di mana keterangan saksi berbeda?', 'Where do the accounts differ?', 'd1p4'],
  ['th-keys', 'Siapa yang memegang kunci gudang?', 'Who held the warehouse keys?', 'd2p2'],
  ['th-timeline', 'Kapan truk meninggalkan gerbang?', 'When did the truck leave the gate?', 'd3p3'],
  ['th-patrol', 'Kapan patroli dicatat?', 'When were the patrols logged?', 'd3p4'],
];
const updated = Date.parse('2026-11-04T00:00:00Z');
const threads = prompts.map(([id, idTitle, enTitle, passageId], index) => {
  const title = { id: idTitle, en: enTitle };
  const passage = passages.find(p => p.id === passageId);
  return {
    id, caseId, title, updated: updated - index * 60_000, sample: true,
    messages: [
      { id: id + '-q', role: 'user', text: title, contexts: [{ kind: 'case' }] },
      { id: id + '-a', role: 'assistant', text: '“' + passage.text + '” [1]', mode: 'sources-only', citations: [{kind:'passage', id:passageId}] },
    ],
  };
});
const workspace = {
  caseRecord, hearings, documents, passages, boards: [], threads, version: 1,
  speakers: record.speakers, statements: record.statements.filter(s => hearings.some(h => h.id === s.hearingId)),
  findings: record.findings, connections: record.connections, legal: record.legal, replies: [],
};
files['manifest.json'] = strToU8(JSON.stringify({format:'jude',version:1,caseId,title:caseRecord.title}));
files['case.json'] = strToU8(JSON.stringify(workspace));
const archive = zipSync(files, { level: 6, mtime: new Date(2026, 10, 4) });
await mkdir(destination, {recursive:true});
await writeFile(new URL('warehouse-v1.jude', destination), archive);
