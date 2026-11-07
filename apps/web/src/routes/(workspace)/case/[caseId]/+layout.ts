import { caseSnapshot, checkWorkspaceScope, workspaceAccessLost } from '$lib/workspace/tab-cache';
import { workspaceScope } from '$lib/workspace/scope';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ data, parent, fetch, url }) => {
  if (!data.caseGuard) return await workspaceAccessLost();
  const { account } = await parent();
  await checkWorkspaceScope(data.caseGuard.scope, workspaceScope(account), () => url.href);
  return { workspace: await caseSnapshot(fetch, data.caseGuard) };
};
