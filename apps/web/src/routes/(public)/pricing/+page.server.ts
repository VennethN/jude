import { error } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { salesAction } from '$lib/public/forms.server';
import { cycleFrom, type PlanCatalog } from '@jude/core/plans';

export const load: PageServerLoad = async ({ fetch, url }) => {
	const response = await fetch('/api/plans');
	if (!response.ok) error(503, 'Plan catalogue unavailable');
	const catalogue: PlanCatalog = await response.json();
	return { plans: catalogue.plans, cycle: cycleFrom(url.searchParams.get('cycle')),
		target: url.searchParams.get('plan'), showContact: url.searchParams.has('contact') };
};
export const actions: Actions = { contact: salesAction };
