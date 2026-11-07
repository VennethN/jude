import type { Actions } from './$types';
import { accountAction } from '$lib/public/forms.server';

export const actions: Actions = { default: accountAction('signup') };
