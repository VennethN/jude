import {
  currency,
  featureNames,
  localized,
  quotaNames,
  type BillingCycle,
  type Language,
  type LocalText,
  type Plan,
  type PlanId,
  type QuotaId,
} from '@jude/core/plans';

type FeatureId = keyof typeof featureNames;
type ComparisonGroup = { title: LocalText; rows: (FeatureId | QuotaId)[] };
export const comparison: ComparisonGroup[] = [
  {
    title: localized('Sidang', 'Hearings'),
    rows: ['hours', 'upload_transcription', 'live_transcription', 'response_suggestions', 'bookmarks_search'],
  },
  {
    title: localized('Temuan & asisten', 'Findings & assistant'),
    rows: [
      'findings_with_sources',
      'case_assistant',
      'questions',
      'boards',
      'ai_note_suggestions',
      'pasal_references',
    ],
  },
  { title: localized('Perkara & dokumen', 'Cases & documents'), rows: ['cases', 'storage', 'jude_export'] },
  {
    title: localized('Tim & keamanan', 'Team & security'),
    rows: [
      'seats',
      'team_sharing',
      'case_roles',
      'priority_support',
      'sso_audit_log',
      'jakarta_residency',
      'dedicated_contact',
    ],
  },
];
export const rowNames = {
  ...featureNames,
  ...quotaNames,
  hours: localized('Jam sidang ditranskripsi per bulan', 'Hearing hours transcribed per month'),
  upload_transcription: localized(
    'Transkripsi rekaman yang diunggah',
    'Transcription of uploaded hearing recordings',
  ),
  response_suggestions: localized(
    'Saran tanggapan saat giliran Anda',
    'Response suggestions when it is your turn',
  ),
  bookmarks_search: localized(
    'Penanda pernyataan dan pencarian transkrip',
    'Statement bookmarks and transcript search',
  ),
  findings_with_sources: localized(
    'Temuan berdampingan dengan sumbernya',
    'Findings alongside their sources',
  ),
  case_assistant: localized('Asisten perkara dengan kutipan sumber', 'Case assistant with cited sources'),
  boards: localized('Papan temuan tersimpan', 'Saved findings boards'),
  storage: localized('Penyimpanan dokumen dan rekaman (GB)', 'Document and recording storage (GB)'),
  team_sharing: localized('Papan dan perkara bersama tim', 'Boards and cases shared with your team'),
  case_roles: localized('Peran dan izin per perkara', 'Roles and permissions per case'),
  jakarta_residency: localized('Opsi penyimpanan di wilayah Jakarta', 'Jakarta data residency option'),
  dedicated_contact: localized('Pendamping khusus untuk tim', 'Dedicated team contact'),
};
export const isQuota = (key: QuotaId | FeatureId): key is QuotaId => Object.hasOwn(quotaNames, key);
export function quotaValue(plan: Plan, key: QuotaId, lang: Language) {
  const n = plan.quotas[key];
  if (n === null)
    return plan.contract
      ? localized('Sesuai kontrak', 'By arrangement')[lang]
      : localized('Tanpa batas', 'Unlimited')[lang];
  const number = new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(n);
  if (key === 'storage') return number + ' GB';
  if (key === 'seats' && n > 1) return (lang === 'id' ? 'Hingga ' : 'Up to ') + number;
  return number;
}
export function price(plan: Plan, cycle: BillingCycle, lang: Language) {
  const rate = cycle === 'yearly' ? plan.yearlyPerMonth : plan.monthly;
  return rate === null ? localized('Sesuai kebutuhan', 'Custom')[lang] : currency(rate, lang);
}
export const period = (plan: Plan, lang: Language) =>
  plan.monthly
    ? (plan.perUser
        ? localized('per pengguna per bulan', 'per user per month')
        : localized('per bulan', 'per month'))[lang]
    : '';
export function actionLabel(plan: Plan, lang: Language, current?: PlanId) {
  if (current === plan.id) return localized('Kelola paket', 'Manage plan')[lang];
  if (plan.contract) return localized('Hubungi tim', 'Contact team')[lang];
  if (plan.trial)
    return localized('Coba ' + plan.name.id + ' 14 hari', 'Try ' + plan.name.en + ' for 14 days')[lang];
  return localized('Mulai dengan Dasar', 'Start with Basic')[lang];
}
export function actionHref(plan: Plan, cycle: BillingCycle, signedIn: boolean) {
  if (plan.contract) return '/pricing?cycle=' + cycle + '&contact=1#partner';
  return (signedIn ? '/billing' : '/signup') + '?plan=' + plan.id + '&cycle=' + cycle;
}
export const essentials = [
  {
    clay: 'finding',
    title: localized('Temuan dengan sumbernya', 'Findings with their sources'),
    text: localized(
      'Baca kutipan dan nomor halaman dokumen di samping keterangan yang sedang Anda periksa.',
      'Read a document quotation and its page beside the testimony you are checking.',
    ),
  },
  {
    clay: 'gavel',
    title: localized('Transkrip yang bisa dicari', 'Transcripts you can search'),
    text: localized(
      'Temukan siapa berbicara dan kapan, lalu tandai keterangan yang ingin Anda tinjau lagi.',
      'Find who spoke and when. Bookmark the testimony you want to revisit.',
    ),
  },
  {
    clay: 'scales',
    title: localized('Rujukan Pasal.id', 'Pasal.id references'),
    text: localized(
      'Buka rujukan untuk pasal yang disebut dalam persidangan dan berkas perkara.',
      'Follow references to articles cited in a hearing or in the case file.',
    ),
  },
  {
    clay: 'quote',
    title: localized('Asisten yang mengutip', 'An assistant that cites'),
    text: localized(
      'Tanyakan isi berkas perkara, lalu telusuri kutipan sumber di dalam jawabannya.',
      'Ask about the case and follow the sources cited in the answer.',
    ),
  },
];
export const faq = [
  {
    q: localized('Apakah Jude menilai siapa yang benar?', 'Does Jude decide who is telling the truth?'),
    a: localized(
      'Jude memperlihatkan keterangan dan kutipan sumbernya untuk Anda periksa. Penilaian kredibilitas dan hasil perkara berada di tangan praktisi dan pengadilan.',
      'Jude brings testimony and its sources together for you to review. Practitioners and the court assess credibility and the outcome of the case.',
    ),
  },
  {
    q: localized('Bagaimana uji coba 14 hari bekerja?', 'How does the 14-day trial work?'),
    a: localized(
      'Advokat Pro dan Firma dapat dicoba selama 14 hari tanpa kartu. Akun kembali ke Dasar saat uji coba berakhir, kecuali Anda memilih paket.',
      'Try Advocate Pro or Firm for 14 days without a card. Your account returns to Basic at the end of the trial unless you choose a plan.',
    ),
  },
  {
    q: localized('Apa yang dihitung sebagai jam sidang?', 'What counts as a hearing hour?'),
    a: localized(
      'Durasi sidang yang direkam dan audio unggahan dihitung dalam kuota bulanan. Mengimpor transkrip teks tidak memakai jam transkripsi.',
      'Recorded hearings and uploaded audio use the monthly quota according to their duration. Text transcript imports use no transcription hours.',
    ),
  },
  {
    q: localized('Bisakah saya berganti paket?', 'Can I change plans?'),
    a: localized(
      'Buka Paket & tagihan di ruang kerja untuk memilih paket. Materi yang ada tetap tersimpan. Jika pemakaian melebihi kuota baru, Anda dapat menambah materi setelah pemakaian turun.',
      'Choose a plan from Plans & billing in your workspace. Your existing materials stay saved. When usage exceeds a new quota, you can add more once usage is below it.',
    ),
  },
  {
    q: localized('Bagaimana dengan berkas perkara saya?', 'What happens to my case files?'),
    a: localized(
      'Dokumen sumber disimpan dalam bahasa aslinya. Mulai dari Advokat Pro, perkara dapat diekspor sebagai arsip .jude beserta berkas aslinya. Tim Jude dapat membahas kebutuhan penyimpanan organisasi dengan Anda.',
      'Original documents stay in their source language. From Advocate Pro, you can export a case and its original files in a .jude archive. Speak with the Jude team about your organisation’s storage requirements.',
    ),
  },
  {
    q: localized('Apakah Jude bisa dipakai dalam bahasa Inggris?', 'Can I use Jude in English?'),
    a: localized(
      'Antarmuka tersedia dalam Bahasa Indonesia dan Inggris. Ganti bahasa kapan saja. Kutipan dokumen dan keterangan di sidang tetap mengikuti bahasa sumbernya.',
      'Switch between Indonesian and English at any time. Document quotations and hearing testimony stay in the language of the original record.',
    ),
  },
];
