import type { Lang } from '@jude/core/domain';
import type { CaptureState, LiveTranscriptTurn, Recorder } from '../microphone';

type Session = { key: string; state: CaptureState; partial?: LiveTranscriptTurn; elapsed: number; runningSince: number };
let active = $state<Session | null>(null);
let device: Recorder | undefined;
let release: (() => void) | undefined;

export function getCapture(key: string) {
  return active?.key === key ? active : null;
}

export async function connectCapture(
  caseId: string,
  hearingId: string,
  userId: string,
  keep: boolean,
  startedAt: string | undefined,
  language: Lang = 'id',
  recoverOnly = false
) {
  const key = [userId, caseId, hearingId].join('/');
  if (active) throw new Error('capture_in_use');
  const elapsed = startedAt ? Math.max(0, (Date.now() - Date.parse(startedAt)) / 1000) : 0;
  active = { key, state: 'connecting', elapsed, runningSince: 0 };
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
      },
      (turn) => {
        if (active?.key === key) active.partial = turn;
      },
      language,
      recoverOnly
    );
  } catch (error) {
    release?.();
    release = undefined;
    active = null;
    throw error;
  }
}

export function pauseCapture(key: string, paused: boolean) {
  if (active?.key === key) return device?.paused(paused);
}

export async function drainCapture(caseId: string, hearingId: string, userId: string, language: Lang) {
  await connectCapture(caseId, hearingId, userId, false, undefined, language, true);
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
