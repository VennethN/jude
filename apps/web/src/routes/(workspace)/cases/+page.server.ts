import { redirect } from '@sveltejs/kit';
import { registerGuard } from '$lib/server/workspace-guard';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, depends }) => {
  depends('jude:case-library');
  if (!locals.session) redirect(303, '/login?next=%2Fcases');
  return registerGuard(locals.session);
};
