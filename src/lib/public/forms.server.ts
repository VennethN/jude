import { fail, redirect, type RequestEvent } from '@sveltejs/kit';
import { localPath } from '$lib/paths';
import { cycleFrom, type Language } from './plans';

export async function postJson(event: RequestEvent, path: string, fields: Record<string, unknown>) {
	const response = await event.fetch(path, {
		method: 'POST', headers: { 'content-type': 'application/json', origin: event.url.origin },
		body: JSON.stringify(fields)
	});
	const result = await response.json().catch(() => ({}));
	return { response, result };
}
export type AccountMode = 'login' | 'signup' | 'reset' | 'invite';
export function accountAction(mode: AccountMode) {
	return async (event: RequestEvent) => {
		const fields = await event.request.formData();
		const query = event.url.searchParams;
		const name = String(fields.get('name') ?? '').trim();
		const email = String(fields.get('email') ?? '').trim();
		const password = String(fields.get('password') ?? '');
		const lang: Language = fields.get('lang') === 'en' ? 'en' : 'id';
		const token = mode === 'invite' ? event.params.token : query.get('token');
		const endpoint = mode === 'reset' && token ? 'reset/confirm' : mode;
		const planId = query.get('plan');
		const cycle = cycleFrom(query.get('cycle'));
		const payload: Record<string, unknown> = { lang };
		if (mode === 'signup' || mode === 'invite') payload.name = name;
		if (mode !== 'invite' && !(mode === 'reset' && token)) payload.email = email;
		if (mode !== 'reset' || token) payload.password = password;
		if (token) payload.token = token;
		if (mode === 'signup' && (planId === 'basic' || planId === 'pro' || planId === 'firm')) {
			payload.planId = planId;
			payload.cycle = cycle;
		}
		const { response, result } = await postJson(event, '/api/auth/' + endpoint, payload);
		if (!response.ok) return fail(response.status, { ok: false, error: String(result.error?.code ?? 'request_failed'), email, name });
		if (mode === 'reset') return { ok: true, error: '', email, name };
		const destination = mode === 'signup' && planId ? '/billing' : '/cases';
		redirect(303, localPath(query.get('next'), destination));
	};
}
export async function salesAction(event: RequestEvent) {
	const fields = await event.request.formData();
	const values = Object.fromEntries(['name','email','org','size','message','website'].map((key) => [key,String(fields.get(key) ?? '').trim()]));
	const { response, result } = await postJson(event, '/api/sales/contact', { ...values, size: values.size ? Number(values.size) : undefined });
	if (!response.ok) return fail(response.status, { kind: 'sales', ok: false, error: String(result.error?.code ?? 'request_failed'), values });
	return { kind: 'sales', ok: true, error: '', values: { email: values.email } };
}
