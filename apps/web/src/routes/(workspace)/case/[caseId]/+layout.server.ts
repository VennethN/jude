import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import type { Workspace } from '@jude/core/domain';

export const load: LayoutServerLoad = async ({ params, fetch, depends }) => {
  depends('jude:case');
  const response = await fetch('/api/cases/' + encodeURIComponent(params.caseId) + '/workspace');
  if (response.status === 404 || response.status === 403) redirect(303, '/cases?notice=case-unavailable');
  if (!response.ok) error(response.status, { message: 'Gagal membuka perkara.' });
  const workspace: Workspace = await response.json();
  return { workspace };
};
