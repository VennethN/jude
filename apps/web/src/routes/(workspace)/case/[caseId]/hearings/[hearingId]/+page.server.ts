import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent, params }) => {
  const { workspace, lang } = await parent();
  if (!workspace.hearings.some((h) => h.id === params.hearingId)) {
    error(404, lang === 'id' ? 'Sidang tidak ditemukan.' : 'Hearing not found.');
  }
  return { hearingId: params.hearingId };
};
