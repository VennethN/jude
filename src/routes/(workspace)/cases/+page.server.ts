import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { CaseSummary } from '$lib/domain';
export const load: PageServerLoad = async ({ fetch }) => {
  const r = await fetch('/api/cases');
  if (!r.ok) error(r.status, { message: 'Gagal memuat daftar perkara.' });
  const data: { cases: CaseSummary[] } = await r.json();
  return data;
};
