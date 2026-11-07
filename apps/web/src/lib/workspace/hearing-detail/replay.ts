import { api } from '$lib/client';
import type { LiveTranscriptTurn } from '../microphone';

interface Preview {
  cursor: number;
  done: boolean;
  turn?: LiveTranscriptTurn & { durationMs: number };
}

function wait(duration: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', stop);
      resolve();
    }, duration);
    function stop() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', stop, { once: true });
  });
}

export async function runReplay(path: string, cursor: number, previous: LiveTranscriptTurn | undefined,
  signal: AbortSignal, draft: (turn?: LiveTranscriptTurn) => void, refresh: () => Promise<void>) {
  let delay = previous ? 0 : 2200;
  while (!signal.aborted) {
    const preview = await api<Preview>(path + '?cursor=' + cursor);
    signal.throwIfAborted();
    if (preview.cursor !== cursor) {
      await refresh();
      signal.throwIfAborted();
      cursor = preview.cursor;
      previous = undefined;
      draft();
      if (!preview.done && !preview.turn) continue;
    }
    if (preview.done) { draft(); return; }
    const turn = preview.turn;
    if (!turn) throw new Error('missing_replay_turn');
    await wait(delay, signal);
    const ended = [...turn.text.matchAll(/\S+/gu)].map(match => match.index + match[0].length);
    const resume = previous?.id === turn.id ? previous.text.length : 0;
    const wordDelay = Math.max(60, (turn.durationMs - 420) / Math.max(1, ended.length));
    for (const end of ended) {
      if (end <= resume) continue;
      draft({ id: turn.id, speakerId: turn.speakerId, t: turn.t, text: turn.text.slice(0, end) });
      await wait(wordDelay, signal);
    }
    await wait(420, signal);
    const result = await api<{cursor:number;done:boolean;pause?:number}>(path, 'POST', { cursor });
    await refresh();
    signal.throwIfAborted();
    draft();
    if (result.done) return;
    cursor = result.cursor;
    previous = undefined;
    delay = result.pause ?? 1700;
  }
}
