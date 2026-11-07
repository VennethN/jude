import { transcriptionAvailable } from '@jude/core/server/voice-capabilities';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { workspace } = await parent();
  return { canTranscribe: workspace.caseRecord.label === 'private' && (await transcriptionAvailable()) };
};
