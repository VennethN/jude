import { transcriptionAvailable } from '@jude/core/server/voice-capabilities';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => ({ transcription: await transcriptionAvailable() });
