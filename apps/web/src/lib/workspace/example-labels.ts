import type { CaseRecord, L10n, Workspace } from '@jude/core/domain';

// Only known synthetic labels get a translation. Never translate evidence, quotations,
// private records, or names the user has changed. Match text rather than generated IDs
// so examples that were seeded before this UI change also work.
const labels: Record<string, string> = {
  'Perkara Penggelapan Gudang Cakung': 'Cakung Warehouse Embezzlement Case',
  'Perkara Penipuan Arisan Daring': 'Online Savings-Group Fraud Case',
  'Perkara Pencurian Kendaraan Bekasi': 'Bekasi Vehicle Theft Case',
  'Pengadilan Negeri Contoh': 'Example District Court',
  'Hakim Ketua': 'Presiding judge',
  'Hakim Anggota': 'Associate judge',
  'Penuntut Umum': 'Prosecutor',
  'Penasihat Hukum': 'Defense counsel',
  'Saksi Rina Hartati': 'Witness Rina Hartati',
  'Saksi Dimas Prasetyo': 'Witness Dimas Prasetyo',
  'Terdakwa Budi Santoso': 'Defendant Budi Santoso',
  'BAP Saksi Rina Hartati': 'Rina Hartati witness statement (BAP)',
  'BAP Saksi Dimas Prasetyo': 'Dimas Prasetyo witness statement (BAP)',
  'Laporan Log Akses Gerbang & CCTV': 'Gate access log & CCTV report',
  'Surat Dakwaan PDM-112/2026': 'Indictment PDM-112/2026',
  'Berita Acara Stock Opname Gudang B': 'Warehouse B stocktaking report',
  'Laporan Polisi LP/B/0451/2026': 'Police report LP/B/0451/2026',
  'Tangkapan Layar Grup Arisan': 'Savings-group chat screenshots',
};
const questions: Record<string, string> = {
  "Saudara menyebut tiba jam setengah sepuluh. Apakah itu saat Saudara tap kartu di gerbang, atau saat mulai berjaga setelah dari warung?": "You said you arrived at half past nine. Was that when you tapped your card at the gate, or when you started your shift after visiting the stall?",
  "Dari tempat Saudara berjaga, berapa jauh jarak ke Gerbang Timur, dan apakah Saudara melihat truk itu masuk sebelumnya?": "How far was the East Gate from your post, and did you see the truck enter earlier?",
  "Dari mana Saudara tahu siapa yang memegang kunci Gudang B? Apakah Saudara pernah melihat orang lain memegangnya?": "How do you know who held the keys to Warehouse B? Have you ever seen anyone else holding them?",
  "Pada malam 14 Maret, apakah Saudara melihat sendiri siapa yang berada di dalam truk itu?": "On the night of 14 March, did you personally see who was inside the truck?",
  "Apakah patroli setiap satu jam itu aturan jaga, atau yang Saudara lakukan malam 14 Maret? Catatan patroli menunjukkan jeda sekitar dua jam.": "Was patrolling every hour the rule, or what you actually did on the night of 14 March? The patrol log shows intervals of about two hours.",
  "Jam berapa tepatnya Sdr. Yusuf meninggalkan pos setelah Saudara datang?": "At exactly what time did Yusuf leave the post after you arrived?",
  "Selain Gerbang Timur, apakah ada jalan masuk ke Gudang B yang tidak memakai kartu akses?": "Apart from the East Gate, is there an entrance to Warehouse B that does not require an access card?"
};
function translation(original: string): L10n | undefined {
  return Object.hasOwn(labels, original) ? { id: original, en: labels[original] } : undefined;
}
export function exampleCaseLabels<T extends CaseRecord>(record: T): T {
  if (record.label !== 'synthetic') return record;
  return { ...record, displayTitle: translation(record.title), displayCourt: translation(record.court) };
}
export function exampleWorkspaceLabels(workspace: Workspace): Workspace {
  if (workspace.caseRecord.label !== 'synthetic') return workspace;
  return {
    ...workspace,
    caseRecord: exampleCaseLabels(workspace.caseRecord),
    findings: workspace.findings.map(finding => ({ ...finding,
      questionTranslation: Object.hasOwn(questions, finding.question)
        ? { id: finding.question, en: questions[finding.question] } : finding.questionTranslation,
    })),
    documents: workspace.documents.map(document => ({ ...document, displayTitle: translation(document.title) })),
    speakers: workspace.speakers.map(speaker => ({ ...speaker, displayLabel: translation(speaker.label) })),
  };
}
