import type { Lang } from '@jude/core/domain';
import { ApiError } from '$lib/client';

export function assistantError(error: unknown, lang: Lang) {
  const id = lang === 'id';
  if (error instanceof ApiError) {
    if (error.code === 'stream_interrupted') return id ? 'Sambungan terputus. Coba lagi untuk melanjutkan jawaban; draf Anda tetap tersimpan.' : 'The connection was interrupted. Try again to recover the answer; your draft is saved.';
    if (error.status === 402) return id ? 'Batas pertanyaan paket ini tercapai. Lihat paket untuk melanjutkan.' : 'This plan’s question limit has been reached. View your plan to continue.';
    if (error.status === 401) return id ? 'Sesi berakhir. Masuk kembali untuk melanjutkan.' : 'Your session has expired. Sign in again to continue.';
    if (error.status === 403 || error.status === 404) return id ? 'Percakapan atau akses perkara ini tidak lagi tersedia.' : 'This conversation or access to the case is no longer available.';
    if (error.status === 409) return id ? 'Percakapan atau sumber berubah. Muat ulang lalu kirim kembali pertanyaan.' : 'The conversation or sources changed. Reload, then send your question again.';
    if (error.status === 422) return id ? 'Periksa konteks dan panjang pertanyaan (maksimal 6.000 karakter).' : 'Check the context and question length (maximum 6,000 characters).';
    if (error.status === 429) return id ? 'Terlalu banyak permintaan. Tunggu sebentar lalu coba lagi.' : 'Too many requests. Wait a moment, then try again.';
    if (error.code === 'request_stopped') return id ? 'Permintaan melewati batas waktu. Draf disimpan; silakan coba lagi.' : 'The request timed out. Your draft is saved; please try again.';
  }
  return id ? 'Jawaban belum tersedia. Periksa koneksi lalu coba lagi; draf Anda tetap tersimpan.' : 'The answer is unavailable. Check your connection and try again; your draft is saved.';
}
