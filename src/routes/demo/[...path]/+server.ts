import { redirect, error } from '@sveltejs/kit';
import { beginDemo } from '$lib/server/auth';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const who = event.locals.session ?? await beginDemo(event);
  if (!who.demo) redirect(303,'/cases');
  const parts = (event.params.path ?? '').split('/').filter(Boolean);
  if (parts.length > 2 || (parts[0] && !['hearings','documents','findings','connections','assistant'].includes(parts[0]))) error(404);
  const path = parts.map(s => encodeURIComponent(who.demo!.refs[s] ?? s));
  redirect(303, ['/case',encodeURIComponent(who.demo.caseId),...path].join('/') + event.url.search);
};
