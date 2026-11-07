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
    documents: workspace.documents.map(document => ({ ...document, displayTitle: translation(document.title) })),
    speakers: workspace.speakers.map(speaker => ({ ...speaker, displayLabel: translation(speaker.label) })),
  };
}
