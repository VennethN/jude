/** The independently deployed voice app owns its model configuration. */
export async function transcriptionAvailable(): Promise<boolean> {
  const origin =
    process.env.VOICE_ORIGIN || (process.env.NODE_ENV !== 'production' ? 'http://127.0.0.1:3001' : '');
  if (!origin) return false;
  try {
    const gateway = new URL(origin);
    const path = gateway.protocol === 'https:' ? '/api/live/capabilities' : '/capabilities';
    const response = await fetch(new URL(path, gateway), { signal: AbortSignal.timeout(3500), redirect: 'error', cache: 'no-store' });
    return response.ok && (await response.json()).transcription === true;
  } catch {
    return false;
  }
}
