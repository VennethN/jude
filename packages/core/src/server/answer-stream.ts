import type { AnswerStreamEvent, AssistantStage, ChatMessage, Thread } from '../domain';
import { ApiError } from './validation';

type Partial = (message: ChatMessage) => void;
type Generate = (publish: Partial, signal?: AbortSignal) => Promise<Thread>;

interface RunningAnswer {
  result: Promise<Thread>;
  listeners: Set<Partial>;
  last?: ChatMessage;
  controller: AbortController;
}

// Reconnect to an accepted request while the provider is still responding. The database
// idempotency transaction remains authoritative across processes and restarts.
const running = new Map<string, RunningAnswer>();

export function sharedAnswer(key: string | undefined, generate: Generate, publish?: Partial, signal?: AbortSignal) {
  if (!key) return generate(message => { if (!signal?.aborted) publish?.(message); }, AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]));

  let entry = running.get(key);
  if (!entry) {
    const controller = new AbortController();
    const listeners = new Set<Partial>();
    const result = Promise.resolve().then(() => generate(message => {
      current.last = message;
      for (const listener of listeners) listener(message);
    }, AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]))).finally(() => running.delete(key));
    const current: RunningAnswer = { listeners, result, controller };
    running.set(key, current);
    entry = current;
  }
  if (!publish || signal?.aborted) return entry.result;

  const current = entry;
  const forget = () => current.listeners.delete(publish);
  current.listeners.add(publish);
  signal?.addEventListener('abort', forget, { once: true });
  if (current.last) publish(current.last);
  return current.result.finally(() => {
    forget();
    signal?.removeEventListener('abort', forget);
  });
}

export function cancelAnswer(key: string) {
  const answer = running.get(key);
  if (!answer) return false;
  answer.controller.abort();
  return true;
}

export function answerStream(requestSignal: AbortSignal, generate: (publish: Partial, signal: AbortSignal, progress: (stage: AssistantStage) => void) => Promise<Thread>) {
  const encoder = new TextEncoder();
  const subscription = new AbortController();
  let writer: ReadableStreamDefaultController<Uint8Array> | undefined;

  function send(event: AnswerStreamEvent) {
    if (!subscription.signal.aborted) writer?.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
  }
  function stop() {
    if (subscription.signal.aborted) return;
    subscription.abort();
    requestSignal.removeEventListener('abort', close);
    writer = undefined;
  }
  function close() {
    writer?.close();
    stop();
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
      if (requestSignal.aborted) { close(); return; }
      requestSignal.addEventListener('abort', close, { once: true });
      send({ type: 'status', phase: 'reading' });
      void Promise.resolve()
        .then(() => generate(message => send({ type: 'partial', message }), subscription.signal, phase => send({ type: 'status', phase })))
        .then(thread => send({ type: 'complete', thread }))
        .catch((cause: unknown) => {
          const error = cause instanceof ApiError
            ? { status: cause.status, code: cause.code, message: cause.message }
            : { status: 500, code: 'internal_error', message: 'The request could not be completed.' };
          send({ type: 'error', error });
        })
        .finally(close);
    },
    cancel: stop,
  });
  return new Response(stream, { headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'private, no-store, no-transform',
    'X-Accel-Buffering': 'no',
    Vary: 'Accept',
  } });
}
