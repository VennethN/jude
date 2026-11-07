import { error, redirect } from '@sveltejs/kit';
import { beginDemo } from '@jude/core/server/auth';
import { ApiError } from '@jude/core/server/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const parts = (event.params.path ?? '').split('/').filter(Boolean);
  if (parts.length > 2 || (parts[0] && !['hearings','documents','findings','connections','assistant'].includes(parts[0]))) error(404);
  const session = event.locals.session ?? await beginDemo(event).catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.code === 'rate_limited') {
      const en = event.cookies.get('jude_lang') === 'en';
      error(429, en ? 'Too many example workspaces have been opened. Try again later.' : 'Terlalu banyak ruang contoh telah dibuka. Coba lagi nanti.');
    }
    throw cause;
  });
  if (!session.demo) redirect(303, '/cases');
  const { caseId, refs } = session.demo;
  const path = parts.map(part => encodeURIComponent(refs[part] ?? part));
  redirect(303, ['/case',encodeURIComponent(caseId),...path].join('/') + event.url.search);
};
