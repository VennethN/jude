import { redirect } from '@sveltejs/kit';
import { localPath } from '$lib/paths';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, fetch, locals }) => {
  const form = await request.formData();
  const lang = form.get('lang') === 'en' ? 'en' : 'id';
  cookies.set('jude_lang', lang, { path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: true, sameSite: 'lax' });
  if (locals.session) await fetch('/api/me/prefs', { method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify({lang}) });
  redirect(303,localPath(form.get('next'), '/'));
};
