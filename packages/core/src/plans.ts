import quotas from './plan-quotas.json';
export type Language = 'id' | 'en';
export type LocalText = Record<Language, string>;
export type PlanId = 'basic' | 'pro' | 'firm' | 'partner';
export type BillingCycle = 'monthly' | 'yearly';
export const quotaOrder = ['boards', 'cases', 'hours', 'questions', 'storage', 'seats'] as const;
export type QuotaId = (typeof quotaOrder)[number];

export const localized = (id: string, en: string): LocalText => ({ id, en });
export const quotaNames: Record<QuotaId, LocalText> = {
	boards: localized('Papan temuan', 'Findings boards'),
	cases: localized('Perkara aktif', 'Active cases'),
	hours: localized('Jam transkripsi per bulan', 'Transcription hours per month'),
	questions: localized('Pertanyaan asisten per bulan', 'Assistant questions per month'),
	storage: localized('Penyimpanan (GB)', 'Storage (GB)'),
	seats: localized('Pengguna', 'Seats')
};
export const quotaHelp: Record<QuotaId, LocalText> = {
	boards: localized('Papan di seluruh perkara organisasi.', 'Boards across the organisation’s cases.'),
	cases: localized('Perkara aktif selain perkara contoh.', 'Active cases outside the example case.'),
	hours: localized('Durasi sidang langsung dan rekaman unggahan.', 'Duration of live hearings and uploaded recordings.'),
	questions: localized('Pertanyaan yang diajukan kepada asisten perkara.', 'Questions sent to the case assistant.'),
	storage: localized('Ukuran asli dokumen dan rekaman audio.', 'Original file size of documents and audio recordings.'),
	seats: localized('Anggota yang memiliki akses ke organisasi.', 'Members with access to the organisation.')
};
export const featureNames = {
	upload_transcription: localized('Transkripsi rekaman', 'Uploaded recording transcription'),
	live_transcription: localized('Transkripsi sidang langsung', 'Live hearing transcription'),
	response_suggestions: localized('Saran tanggapan', 'Response suggestions'),
	bookmarks_search: localized('Penanda dan pencarian transkrip', 'Transcript bookmarks and search'),
	findings_with_sources: localized('Temuan dengan sumber', 'Findings with sources'),
	case_assistant: localized('Asisten dengan kutipan', 'Case assistant with citations'),
	ai_note_suggestions: localized('Saran catatan di papan', 'Suggested board notes'),
	pasal_references: localized('Rujukan Pasal.id', 'Pasal.id references'),
	jude_export: localized('Ekspor berkas .jude', '.jude archive export'),
	team_sharing: localized('Berbagi perkara dan papan', 'Shared cases and boards'),
	case_roles: localized('Izin per perkara', 'Case permissions'),
	priority_support: localized('Dukungan prioritas', 'Priority support'),
	sso_audit_log: localized('SSO dan log audit', 'SSO and audit log'),
	jakarta_residency: localized('Opsi wilayah Jakarta', 'Jakarta residency option'),
	dedicated_contact: localized('Pendamping khusus', 'Dedicated support contact')
};
type FeatureId = keyof typeof featureNames;
export interface Plan {
	id: PlanId;
	tier: number;
	name: LocalText;
	tagline: LocalText;
	monthly: number | null;
	yearly: number | null;
	yearlyPerMonth: number | null;
	yearlySaving: number | null;
	perUser: boolean;
	trial: boolean;
	contract: boolean;
	quotas: Record<QuotaId, number | null>;
	features: FeatureId[];
	bullets: LocalText[];
}
export const monthsPaidPerYear = 10;
const basic: FeatureId[] = ['upload_transcription', 'bookmarks_search', 'findings_with_sources', 'case_assistant', 'pasal_references'];
const pro: FeatureId[] = [...basic, 'live_transcription', 'response_suggestions', 'ai_note_suggestions', 'jude_export'];
const firm: FeatureId[] = [...pro, 'team_sharing', 'case_roles', 'priority_support'];
const partner: FeatureId[] = [...firm, 'sso_audit_log', 'jakarta_residency', 'dedicated_contact'];
function plan(input: Omit<Plan, 'yearly' | 'yearlyPerMonth' | 'yearlySaving' | 'contract' | 'trial'>): Plan {
	const yearly = input.monthly === null ? null : input.monthly * monthsPaidPerYear;
	return {
		...input, yearly, yearlyPerMonth: yearly === null ? null : Math.ceil(yearly / 12000) * 1000,
		yearlySaving: input.monthly === null ? null : input.monthly * (12 - monthsPaidPerYear),
		contract: input.id === 'partner', trial: input.id === 'pro' || input.id === 'firm'
	};
}
export const plans: Plan[] = [
	plan({
		id: 'basic', tier: 0, name: localized('Dasar', 'Basic'),
		tagline: localized('Untuk mulai menyusun berkas perkara sendiri.', 'For starting your own case file.'),
		monthly: 0, perUser: false, quotas: quotas.basic,
		features: basic, bullets: [featureNames.findings_with_sources, featureNames.case_assistant, localized('Satu papan temuan', 'One findings board')]
	}),
	plan({
		id: 'pro', tier: 1, name: localized('Advokat Pro', 'Advocate Pro'),
		tagline: localized('Untuk advokat yang menangani beberapa perkara.', 'For advocates handling several cases at once.'),
		monthly: 349000, perUser: false, quotas: quotas.pro,
		features: pro, bullets: [featureNames.live_transcription, featureNames.ai_note_suggestions, featureNames.jude_export]
	}),
	plan({
		id: 'firm', tier: 2, name: localized('Firma', 'Firm'),
		tagline: localized('Untuk tim yang bekerja pada berkas bersama.', 'For teams working on shared case files.'),
		monthly: 899000, perUser: true, quotas: quotas.firm,
		features: firm, bullets: [featureNames.team_sharing, featureNames.case_roles, featureNames.priority_support]
	}),
	plan({
		id: 'partner', tier: 3, name: localized('Mitra', 'Partner'),
		tagline: localized('Untuk kebutuhan kantor hukum yang disepakati secara khusus.', 'For law offices with individually agreed requirements.'),
		monthly: null, perUser: false, quotas: quotas.partner,
		features: partner, bullets: [localized('Kapasitas sesuai kontrak', 'Capacity by arrangement'), localized('Diskusi kebutuhan akses', 'Access requirements review'), localized('Pendampingan tim', 'Team onboarding')]
	})
];
export function planById(id: string | undefined | null): Plan {
	return plans.find((item) => item.id === id) ?? plans[0];
}
export function currency(value: number, lang: Language): string {
	return 'Rp' + new Intl.NumberFormat(lang === 'id' ? 'id-ID' : 'en-US').format(value);
}
export function cycleFrom(value: string | null): BillingCycle {
	return value === 'monthly' ? 'monthly' : 'yearly';
}
export const planCatalog = {
	version: '2026-11-07', currency: 'IDR', monthsPaidPerYear, recommended: 'pro' as PlanId,
	trial: { days: 14, cardRequired: false, plans: ['pro', 'firm'], fallbackPlan: 'basic' },
	pricesAreExamples: true, billingMode: 'simulated', quotaOrder, monthlyQuotas: ['hours', 'questions'],
	quotaNames, quotaHelp, featureNames, plans
};
export type PlanCatalog = typeof planCatalog;
export interface BillingAccount {
	planId: PlanId;
	cycle: BillingCycle;
	status: string;
	trialEndsAt: string | null;
	resetsOn?: string;
	seats?: number;
	usage: Partial<Record<QuotaId, number | { used: number; limit: number | null }>>;
}
