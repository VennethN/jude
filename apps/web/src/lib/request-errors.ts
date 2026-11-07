import type { Lang } from '@jude/core/domain';

const messages: Record<string, [string, string]> = {
  unauthenticated: ['Masuk untuk membuka ruang kerja ini.', 'Sign in to access this workspace.'],
  forbidden: ['Anda tidak memiliki izin untuk tindakan ini.', 'You do not have permission for this action.'],
  not_found: ['Catatan tidak ditemukan atau tidak dapat diakses.', 'This record was not found or is unavailable.'],
  validation: ['Periksa isian lalu coba lagi.', 'Check the fields and try again.'],
  conflict: ['Catatan berubah atau tindakan tidak lagi tersedia. Muat ulang lalu coba lagi.', 'The record changed or this action is no longer available. Reload and try again.'],
  provider_unavailable: ['Layanan belum tersedia. Coba lagi nanti.', 'The service is unavailable. Try again later.'],
  rate_limited: ['Terlalu banyak permintaan. Coba lagi sebentar.', 'Too many requests. Please try again shortly.'],
  quota_exceeded: ['Batas pemakaian paket tercapai. Periksa pemakaian dan paket Anda.', 'Your plan limit has been reached. Check your usage and plan.'],
  feature_not_in_plan: ['Fitur ini memerlukan paket yang sesuai. Periksa pilihan paket.', 'This feature requires an eligible plan. Check the available plans.'],
  document_too_large: ['Batas per berkas adalah 25 MB.', 'The limit is 25 MB per file.'],
  file_too_large: ['Berkas atau isinya melebihi batas ukuran. Gunakan berkas yang lebih kecil.', 'The file or its contents exceed the size limit. Use a smaller file.'],
  unsupported_media: ['Format berkas ini belum didukung.', 'This file format is not supported.'],
  ingestion_busy: ['Pemrosesan dokumen sedang sibuk. Coba lagi sebentar.', 'Document processing is busy. Try again shortly.'],
  case_archived: ['Pulihkan perkara dari arsip sebelum mengubahnya.', 'Restore the archived case before editing it.'],
  already_recording: ['Masih ada sidang langsung. Selesaikan sidang tersebut terlebih dahulu.', 'A hearing is already live. Finish that hearing first.'],
  invalid_credentials: ['Periksa email dan kata sandi Anda.', 'Check your email and password.'],
  email_in_use: ['Email ini sudah terdaftar. Masuk ke akun Anda.', 'This email is already registered. Sign in to your account.'],
  invalid_token: ['Tautan ini tidak berlaku atau sudah kedaluwarsa. Minta tautan baru.', 'This link is invalid or expired. Request a new link.'],
  network_error: ['Koneksi terputus. Periksa koneksi lalu coba lagi.', 'The connection failed. Check your connection and try again.'],
};
export function requestErrorText(code: string, lang: Lang): string {
  const fallback = ['Permintaan belum dapat diselesaikan. Coba lagi.', 'The request could not be completed. Try again.'];
  return (Object.hasOwn(messages, code) ? messages[code] : fallback)[lang === 'en' ? 1 : 0];
}
