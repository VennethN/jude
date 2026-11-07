import { error } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Workspace } from '$lib/domain';

export const load: LayoutServerLoad = async ({ params, fetch, depends }) => {
  depends('jude:case');
  const response = await fetch('/api/cases/' + encodeURIComponent(params.caseId) + '/workspace');
  if (!response.ok) error(response.status, { message: response.status === 404 ? 'Perkara tidak ditemukan.' : 'Gagal membuka perkara.' });
  const workspace: Workspace = await response.json();
  return { workspace };
};
