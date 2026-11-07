import type { Lang } from '@jude/core/domain';

const copy = {
  'nav.hearings': ['Sidang', 'Hearings'],
  'nav.findings': ['Temuan', 'Findings'],
  'nav.documents': ['Dokumen', 'Documents'],
  'top.ask': ['Tanya asisten', 'Ask the assistant'],
  'common.close': ['Tutup', 'Close'],
  'common.hearingN': ['Sidang {n}', 'Hearing {n}'],
  'common.page': ['hal. {n}', 'p. {n}'],
  'status.supported': ['Didukung sumber', 'Supported'],
  'status.potential_inconsistency': ['Berbeda dari sumber', 'Potential inconsistency'],
  'status.context_needed': ['Perlu konteks', 'Context needed'],
  'status.insufficient_evidence': ['Bukti belum cukup', 'Insufficient evidence'],
  'rel.supports': ['mendukung', 'supports'],
  'rel.conflicts': ['berbeda', 'conflicts'],
  'rel.context': ['konteks', 'context'],
  'rel.related': ['terkait', 'related'],
  'fx.openDoc': ['Buka dokumen', 'Open document'],
  'fx.openInHearing': ['Buka di sidang', 'Open in hearing'],
  'fx.board': ['Taruh di papan temuan', 'Put on the findings board'],
  'fl.open': ['Buka di Temuan', 'Open in Findings'],
  'cx.title': ['Keterkaitan', 'Connections'],
  'cx.lead': [
    'Semua bukti perkara menurut jenisnya: keterangan di sidang, temuan, dan kutipan dokumen. Pilih satu untuk melihat kelompok bukti yang terhubung dengannya, lalu sesuaikan pasangannya.',
    "All of the case's evidence by type: testimony from hearings, findings and document passages. Pick one to see the group of evidence it is connected to, then adjust its pairings."
  ],
  'cx.confirmed': ['dikonfirmasi', 'confirmed'],
  'cx.suggested': ['saran Jude', 'suggested by Jude'],
  'cx.map.label': ['Peta bukti', 'Evidence map'],
  'cx.map.groupLabel': ['Kelompok bukti', 'Evidence group'],
  'cx.map.all': ['Semua bukti', 'All evidence'],
  'cx.map.groupHint': [
    'Kelompok ini berisi semua bukti yang terhubung, langsung atau lewat bukti lain. Pilih bukti lain di dalamnya untuk menyorotnya, atau tekan Esc untuk kembali.',
    'This group holds all the evidence that is connected, directly or through other evidence. Pick another piece of it to highlight it, or press Esc to go back.'
  ],
  'cx.map.groupHintTouch': [
    'Kelompok ini berisi semua bukti yang terhubung, langsung atau lewat bukti lain. Ketuk bukti lain di dalamnya untuk menyorotnya, atau ketuk Semua bukti untuk kembali.',
    'This group holds all the evidence that is connected, directly or through other evidence. Tap another piece of it to highlight it, or tap All evidence to go back.'
  ],
  'cx.map.desc': [
    'Bukti menurut jenisnya: satu kolom untuk setiap sidang, satu untuk temuan, dan satu untuk setiap dokumen, masing-masing menurut urutannya. Garis adalah pasangan; warnanya jenis hubungan, utuh bila sudah dikonfirmasi dan putus-putus bila masih saran Jude. Gunakan tombol panah untuk berpindah antarbukti dan Enter untuk melihat kelompoknya.',
    'Evidence by type: a column for each hearing, one for the findings and one for each document, each in its own order. Lines are pairings, coloured by relation, solid once confirmed and dashed while Jude only suggests them. Use the arrow keys to move between pieces of evidence and Enter to see a group.'
  ],
  'cx.map.hint': [
    'Seret untuk menggeser · Ctrl + gulir atau cubit untuk memperbesar · Pilih bukti untuk melihat kelompoknya',
    'Drag to move · Ctrl + scroll or pinch to zoom · Pick evidence to see its group'
  ],
  'cx.map.hintTouch': [
    'Geser untuk berpindah · cubit untuk memperbesar · Ketuk bukti untuk melihat kelompoknya',
    'Drag to move · pinch to zoom · Tap evidence to see its group'
  ],
  'cx.map.pick': ['Cari bukti', 'Find evidence'],
  'cx.map.relations': ['Jenis hubungan yang ditampilkan', 'Relations shown'],
  'cx.map.fit': ['Tampilkan semua', 'Show everything'],
  'cx.map.zoomIn': ['Perbesar', 'Zoom in'],
  'cx.map.zoomOut': ['Perkecil', 'Zoom out'],
  'cx.map.count': ['{n} pasangan', '{n} pairing|{n} pairings'],
  'cx.map.none': ['Belum ada pasangan', 'No pairings yet'],
  'cx.map.empty': [
    'Perkara ini belum punya bukti. Bukti muncul di sini setelah ada sidang atau dokumen.',
    'This case has no evidence yet. It appears here once there are hearings or documents.'
  ],
  'cx.map.zoomTo': ['Perbesar ke {name}', 'Zoom to {name}'],
  'cx.map.exploreDoc': ['Lihat kelompok bukti {name}', 'See the evidence groups of {name}'],
  'cx.group.around': ['Sekitar {what}', 'Around {what}'],
  'cx.group.items': ['{n} bukti', '{n} piece of evidence|{n} pieces of evidence'],
  'cx.group.pairs': ['{n} pasangan', '{n} pairing|{n} pairings'],
  'cx.group.members': ['Bukti dalam kelompok ini', 'Evidence in this group'],
  'cx.group.pairings': ['Pasangan', 'Pairings'],
  'cx.group.pairHint': [
    'Pasangan menghubungkan dua bukti. Konfirmasi saran Jude, ubah jenis hubungannya, lepaskan, atau pasangkan bukti lain. Yang dipasangkan temuan diatur di Temuan.',
    "A pairing joins two pieces of evidence. Confirm Jude's suggestions, change how they relate, take them apart, or pair other evidence. What a finding pairs is managed in Findings."
  ],
  'cx.group.confirm': ['Konfirmasi', 'Confirm'],
  'cx.group.unconfirm': ['Batalkan konfirmasi', 'Undo confirmation'],
  'cx.group.unpair': ['Lepas', 'Unpair'],
  'cx.group.pairWith': ['Pasangkan dengan bukti lain', 'Pair with other evidence'],
  'cx.group.pickTitle': ['Pasangkan dengan…', 'Pair with…'],
  'cx.group.about': ['temuan tentang keterangan ini', 'the finding about this line'],
  'cx.group.cited': ['dirujuk temuan', 'cited by a finding'],
  'cx.group.manage': ['Atur di Temuan', 'Manage in Findings'],
  'cx.group.relation': ['Jenis hubungan', 'Relation'],
  'cx.group.alone': [
    'Bukti ini belum punya pasangan. Pasangkan dengan bukti lain untuk memulai kelompok.',
    'This evidence has no pairings yet. Pair it with other evidence to start a group.'
  ]
} as const;

export type MapKey = keyof typeof copy;
export function mapText(lang: Lang, key: MapKey, values?: Record<string, string | number>) {
  let text: string = copy[key][lang === 'id' ? 0 : 1];
  if (text.includes('|')) text = text.split('|')[values?.n === 1 ? 0 : 1];
  return values ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? '')) : text;
}
