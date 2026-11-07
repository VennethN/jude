import { building } from '$app/environment';
import { runAnalysisWorker } from '@jude/core/server/jobs';
import type { Handle, ServerInit } from '@sveltejs/kit';
import { sessionFromToken } from '@jude/core/server/auth';

export const init: ServerInit = () => {
  if (!building) runAnalysisWorker();
};

export const handle: Handle = async ({ event, resolve }) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method)) {
    const origin = event.request.headers.get('origin');
    if (
      (origin && origin !== event.url.origin) ||
      event.request.headers.get('sec-fetch-site') === 'cross-site'
    ) {
      return Response.json(
        { error: { code: 'forbidden', message: 'Open Jude to perform this action.', retryable: false } },
        { status: 403 },
      );
    }
  }
  event.locals.session = await sessionFromToken(event.cookies.get('jude_session'));
  const response = await resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace('%lang%', event.cookies.get('jude_lang') === 'en' ? 'en' : 'id'),
  });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'same-origin');
  if (/^\/(?:api|cases?|billing|demo|login|signup|invite|reset)(?:\/|$)/.test(event.url.pathname)) {
    response.headers.set('Cache-Control', 'private, no-store');
  }
  return response;
};
