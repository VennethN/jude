import type { Lang } from '@jude/core/domain';
import { prepareMicrophone, type PreparedMicrophone } from '../microphone-input';
import type { CaptureState, LiveTranscriptTurn, Recorder } from '../microphone';

type Session = { key: string; state: CaptureState; partial?: LiveTranscriptTurn; elapsed: number; runningSince: number };
let active = $state<Session | null>(null);
let device: Recorder | undefined;
let startFailure = $state.raw<{ key: string; error: unknown }>();
let release: (() => void) | undefined;

export function getCapture(key: string) {
  return active?.key === key ? active : null;
}

export function microphoneStartFailure(key: string) {
  return startFailure?.key === key ? startFailure.error : undefined;
}

// Only called after an explicitly submitted hearing has opened in this browser.
export function connectStartedHearing(caseId: string, hearingId: string, userId: string, keep: boolean, startedAt: string | undefined, language: Lang | undefined, practice: boolean, input: PreparedMicrophone) {
  const key = [userId, caseId, hearingId].join('/');
  void connectCapture(caseId, hearingId, userId, keep, startedAt, language, practice, false, input).catch(error => {
    startFailure = { key, error };
  });
}

export async function connectCapture(
  caseId: string,
  hearingId: string,
  userId: string,
  keep: boolean,
  startedAt: string | undefined,
  language: Lang = 'id',
  practice = false,
  recoverOnly = false,
  prepared?: PreparedMicrophone,
) {
  const key = [userId, caseId, hearingId].join('/');
  startFailure = undefined;
  if (active) { prepared?.release(); throw new Error('capture_in_use'); }
  const input = recoverOnly ? undefined : prepared ?? prepareMicrophone();
  const elapsed = startedAt ? Math.max(0, (Date.now() - Date.parse(startedAt)) / 1000) : 0;
  active = { key, state: recoverOnly ? 'draining' : 'permission', elapsed, runningSince: 0 };
  try {
    if (navigator.locks) {
      await new Promise<void>((resolve, reject) => {
        void navigator.locks
          .request('jude-voice-device-' + userId, { ifAvailable: true }, async (lock) => {
            if (!lock) {
              reject(new Error('capture_in_use'));
              return;
            }
            const held = new Promise<void>((done) => {
              release = done;
            });
            resolve();
            await held;
          })
          .catch(reject);
      });
    }
    const { capture } = await import('../microphone');
    device = await capture(
      caseId,
      hearingId,
      userId,
      keep,
      startedAt,
      (state) => {
        if (active?.key !== key) return;
        const now = Date.now();
        if (active.runningSince) active.elapsed += (now - active.runningSince) / 1000;
        active.runningSince = state === 'recording' || state === 'offline' ? now : 0;
        active.state = state;
        if (state === 'guest_limit') { release?.(); release = undefined; }
      },
      (turn) => {
        if (active?.key === key) active.partial = turn;
      },
      language,
      practice,
      recoverOnly,
      input,
    );
  } catch (error) {
    input?.release();
    release?.();
    release = undefined;
    active = null;
    throw error;
  }
}

export function pauseCapture(key: string, paused: boolean) {
  if (active?.key === key) return device?.paused(paused);
}

export async function drainCapture(caseId: string, hearingId: string, userId: string, language: Lang, practice = false) {
  await connectCapture(caseId, hearingId, userId, false, undefined, language, practice, true);
  await stopCapture([userId, caseId, hearingId].join('/'));
}

export async function stopCapture(key: string) {
  if (active?.key !== key) return;
  if (!device) throw new Error('capture_connecting');
  try {
    await device.stop();
  } finally {
    active = null;
    device = undefined;
    release?.();
    release = undefined;
  }
}
