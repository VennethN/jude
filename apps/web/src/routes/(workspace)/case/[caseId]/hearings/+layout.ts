import { voiceReady } from '$lib/workspace/tab-cache';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async ({ parent, fetch }) => {
  const { workspace } = await parent();
  return { transcription: await voiceReady(fetch, workspace.caseRecord.label) };
};
