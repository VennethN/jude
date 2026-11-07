import { voiceReady } from '$lib/workspace/tab-cache';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, fetch }) => {
  const { workspace } = await parent();
  return { canTranscribe: await voiceReady(fetch, workspace.caseRecord.label) };
};
