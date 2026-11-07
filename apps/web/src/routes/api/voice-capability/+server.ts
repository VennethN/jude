import { json, error } from '@sveltejs/kit';
import { transcriptionAvailable } from '@jude/core/server/voice-capabilities';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.session) error(401, 'Authentication required.');
  return json({ transcription: await transcriptionAvailable() });
};
