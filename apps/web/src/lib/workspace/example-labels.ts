import type { CaseRecord, L10n, Workspace } from '@jude/core/domain';

// Case IDs are generated per organisation. Seeded document and speaker IDs are stable.
const caseTitles: Record<string, string> = {
  'Perkara Penggelapan Gudang Cakung': 'Cakung Warehouse Embezzlement Case',
  'Perkara Penipuan Arisan Daring': 'Online Savings-Group Fraud Case',
  'Perkara Pencurian Kendaraan Bekasi': 'Bekasi Vehicle Theft Case',
};
const court: L10n = { id: 'Pengadilan Negeri Contoh', en: 'Example District Court' };
const speakerLabels: Record<string, L10n> = {
  hk: { id: 'Hakim Ketua', en: 'Presiding judge' },
  ha: { id: 'Hakim Anggota', en: 'Associate judge' },
  pu: { id: 'Penuntut Umum', en: 'Prosecutor' },
  ph: { id: 'Penasihat Hukum', en: 'Defense counsel' },
  rina: { id: 'Saksi Rina Hartati', en: 'Witness Rina Hartati' },
  dimas: { id: 'Saksi Dimas Prasetyo', en: 'Witness Dimas Prasetyo' },
  tdw: { id: 'Terdakwa Budi Santoso', en: 'Defendant Budi Santoso' },
};
const documentTitles: Record<string, L10n> = {
  d1: { id: 'BAP Saksi Rina Hartati', en: 'Rina Hartati witness statement (BAP)' },
  d2: { id: 'BAP Saksi Dimas Prasetyo', en: 'Dimas Prasetyo witness statement (BAP)' },
  d3: { id: 'Laporan Log Akses Gerbang & CCTV', en: 'Gate access log & CCTV report' },
  d4: { id: 'Surat Dakwaan PDM-112/2026', en: 'Indictment PDM-112/2026' },
  d5: { id: 'Berita Acara Stock Opname Gudang B', en: 'Warehouse B stocktaking report' },
  d6: { id: 'Laporan Polisi LP/B/0451/2026', en: 'Police report LP/B/0451/2026' },
  d7: { id: 'Tangkapan Layar Grup Arisan', en: 'Savings-group chat screenshots' },
};
const questions: Record<string, string> = {
  "Saudara menyebut tiba jam setengah sepuluh. Apakah itu saat Saudara tap kartu di gerbang, atau saat mulai berjaga setelah dari warung?": "You said you arrived at half past nine. Was that when you tapped your card at the gate, or when you started your shift after visiting the stall?",
  "Dari tempat Saudara berjaga, berapa jauh jarak ke Gerbang Timur, dan apakah Saudara melihat truk itu masuk sebelumnya?": "How far was the East Gate from your post, and did you see the truck enter earlier?",
  "Dari mana Saudara tahu siapa yang memegang kunci Gudang B? Apakah Saudara pernah melihat orang lain memegangnya?": "How do you know who held the keys to Warehouse B? Have you ever seen anyone else holding them?",
  "Pada malam 14 Maret, apakah Saudara melihat sendiri siapa yang berada di dalam truk itu?": "On the night of 14 March, did you personally see who was inside the truck?",
  "Apakah patroli setiap satu jam itu aturan jaga, atau yang Saudara lakukan malam 14 Maret? Catatan patroli menunjukkan jeda sekitar dua jam.": "Was patrolling every hour the rule, or what you actually did on the night of 14 March? The patrol log shows intervals of about two hours.",
  "Jam berapa tepatnya Sdr. Yusuf meninggalkan pos setelah Saudara datang?": "At exactly what time did Yusuf leave the post after you arrived?",
  "Selain Gerbang Timur, apakah ada jalan masuk ke Gudang B yang tidak memakai kartu akses?": "Apart from the East Gate, is there an entrance to Warehouse B that does not require an access card?",
};
const procedure: L10n = {
  id: 'Mohon waktu sebentar untuk memeriksa berkas, Yang Mulia.',
  en: 'May I have a moment to review the file, Your Honour?',
};

function translation(original: string, translations: Record<string, string>): L10n | undefined {
  return Object.hasOwn(translations, original) ? { id: original, en: translations[original] } : undefined;
}

function matchingLabel(original: string, label?: L10n) {
  return label?.id === original ? label : undefined;
}

export function exampleCaseLabels<T extends CaseRecord>(record: T): T {
  if (record.label !== 'synthetic') return record;
  return { ...record, displayTitle: translation(record.title, caseTitles), displayCourt: matchingLabel(record.court, court) };
}

export function exampleWorkspaceLabels(workspace: Workspace): Workspace {
  if (workspace.caseRecord.label !== 'synthetic') return workspace;
  return {
    ...workspace,
    caseRecord: exampleCaseLabels(workspace.caseRecord),
    findings: workspace.findings.map(finding => ({
      ...finding,
      questionTranslation: finding.questionTranslation ?? translation(finding.question, questions),
    })),
    replies: workspace.replies.map(reply => ({
      ...reply,
      suggestions: reply.suggestions.map(option => ({
        ...option,
        textTranslation: option.textTranslation ?? (option.basis.kind === 'procedure'
          ? matchingLabel(option.text, procedure) : translation(option.text, questions)),
      })),
    })),
    documents: workspace.documents.map(doc => ({ ...doc, displayTitle: matchingLabel(doc.title, documentTitles[doc.id]) })),
    speakers: workspace.speakers.map(person => ({ ...person, displayLabel: matchingLabel(person.label, speakerLabels[person.id]) })),
  };
}
