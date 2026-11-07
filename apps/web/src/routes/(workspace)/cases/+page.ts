import { caseRegister, checkWorkspaceScope } from '$lib/workspace/tab-cache';
import { workspaceScope } from '$lib/workspace/scope';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ data, parent, fetch, url }) => {
  const { account } = await parent();
  await checkWorkspaceScope(data.registerGuard.scope, workspaceScope(account), () => url.href);
  return {
    cases: await caseRegister(fetch, data.registerGuard),
    casesFull: data.casesFull,
    storageFull: data.storageFull,
    caseUnavailable: url.searchParams.get('notice') === 'case-unavailable',
  };
};
