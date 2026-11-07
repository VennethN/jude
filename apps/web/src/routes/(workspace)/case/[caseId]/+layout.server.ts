import { redirect } from '@sveltejs/kit';
import { caseGuard } from '$lib/server/workspace-guard';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ params, locals, depends, url }) => {
  depends('jude:case');
  if (!locals.session) redirect(303, '/login?next=' + encodeURIComponent(url.pathname));
  const guard = await caseGuard(locals.session, params.caseId);
  return { caseGuard: guard ?? null };
};
