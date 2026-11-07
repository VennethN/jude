import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals, url, depends }) => {
  depends('jude:session');
  if (!locals.session) redirect(303, '/login?next=' + encodeURIComponent(url.pathname + url.search));
  return { account: locals.session };
};
