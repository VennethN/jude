import { endpoint } from '@jude/core/server/api';
import { workspaceScope } from '$lib/workspace/scope';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = (event) => {
  const requested = event.request.headers.get('x-jude-workspace');
  if (requested && requested !== workspaceScope(event.locals.session))
    return Response.json({ error: { code: 'scope_changed' } }, { status: event.locals.session ? 409 : 401 });
  return endpoint(event);
};
export const POST = endpoint;
export const PATCH = endpoint;
export const PUT = endpoint;
export const DELETE = endpoint;
