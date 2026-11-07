import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { postJson, salesAction } from '$lib/public/forms.server';
import { cycleFrom, type BillingAccount, type PlanCatalog } from '@jude/core/plans';
export const load: PageServerLoad = async ({ fetch, locals, url }) => {
	if (!locals.session) redirect(303, '/login?next=' + encodeURIComponent(url.pathname + url.search));
	const [accountResponse, catalogueResponse] = await Promise.all([fetch('/api/billing'), fetch('/api/plans')]);
	if (!accountResponse.ok || !catalogueResponse.ok) error(503, 'Billing unavailable');
	const account: BillingAccount = await accountResponse.json();
	const catalogue: PlanCatalog = await catalogueResponse.json();
	return { account, plans: catalogue.plans, cycle: url.searchParams.has('cycle') ? cycleFrom(url.searchParams.get('cycle')) : account.cycle,
		target: url.searchParams.get('plan'), showContact: url.searchParams.has('contact') };
};
export const actions: Actions = {
	contact: salesAction,
	plan: async (event) => {
		if (!event.locals.session) redirect(303, '/login?next=/billing');
		const fields = await event.request.formData();
		const planId = String(fields.get('planId') ?? '');
		const cycle = String(fields.get('cycle') ?? '');
		const { response, result } = await postJson(event,'/api/billing/plan',{planId,cycle});
		if (!response.ok) return fail(response.status, { kind:'plan', ok:false, error:String(result.error?.code ?? 'request_failed') });
		return { kind:'plan',ok:true,error:'' };
	}
};
