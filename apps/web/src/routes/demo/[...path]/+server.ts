import { error, json, redirect } from '@sveltejs/kit';
import { beginDemo } from '@jude/core/server/auth';
import { ApiError } from '@jude/core/server/validation';
import type { RequestEvent, RequestHandler } from './$types';

async function destination(event: RequestEvent) {
  const parts = (event.params.path ?? '').split('/').filter(Boolean);
  if (parts.length > 2 || (parts[0] && !['hearings', 'documents', 'findings', 'connections', 'assistant'].includes(parts[0]))) error(404);
  const session = await beginDemo(event).catch((cause: unknown) => {
    if (cause instanceof ApiError && cause.code === 'rate_limited') {
      const en = event.cookies.get('jude_lang') === 'en';
      error(429, en ? 'Too many example workspaces have been opened. Try again later.' : 'Terlalu banyak ruang contoh telah dibuka. Coba lagi nanti.');
    }
    throw cause;
  });
  if (!session.demo) return '/cases';
  const { caseId, refs } = session.demo;
  const resolve = (id: string) => Object.hasOwn(refs, id) ? refs[id] : id;
  const target = new URL(['/case', encodeURIComponent(caseId), ...parts.map(part => encodeURIComponent(resolve(part)))].join('/'), event.url);
  for (const [key, value] of event.url.searchParams) {
    let mapped = value;
    if (['s', 'f', 'p', 'hearing', 'doc', 'board'].includes(key)) mapped = resolve(value);
    if (['of', 'start', 'context'].includes(key)) {
      const colon = value.indexOf(':');
      mapped = colon < 0 ? resolve(value) : value.slice(0, colon + 1) + resolve(value.slice(colon + 1));
    }
    target.searchParams.append(key, mapped);
  }
  return target.pathname + target.search;
}

export const GET: RequestHandler = async event => redirect(303, await destination(event));
export const POST: RequestHandler = async event => json({ location: await destination(event) });
