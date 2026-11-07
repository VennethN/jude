import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import type { AnswerStreamEvent, ChatMessage, Thread } from '../src/domain';
import { answerStream, sharedAnswer } from '../src/server/answer-stream';
import { ApiError } from '../src/server/validation';

const first: ChatMessage = { id: 'answer', role: 'assistant', mode: 'ai', text: 'First quote [1]', citations: [{ kind: 'statement', id: 's1' }] };
const second: ChatMessage = { ...first, text: 'First quote [1]\n\nSecond quote [2]', citations: [...first.citations!, { kind: 'passage', id: 'p2' }] };
const final: Thread = { id: 't1', caseId: 'c1', updated: 1, title: 'Test', messages: [second] };

async function next(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<AnswerStreamEvent> {
  const chunk = await reader.read();
  expect(chunk.done).toBe(false);
  return JSON.parse(new TextDecoder().decode(chunk.value));
}

test('subscribers receive progress immediately and reconnect to the same in-flight answer', async () => {
  const key = randomUUID(), ready = Promise.withResolvers<void>(), finish = Promise.withResolvers<Thread>();
  let emit!: (message: ChatMessage) => void, calls = 0;
  const generate = (publish: typeof emit) => {
    calls++;
    emit = publish;
    ready.resolve();
    return finish.promise;
  };
  const connect = (signal: AbortSignal) => answerStream(signal, (publish, subscription) => sharedAnswer(key, generate, publish, subscription));
  const request = new AbortController(), firstResponse = connect(request.signal), reader = firstResponse.body!.getReader();
  expect(firstResponse.headers.get('content-type')).toContain('application/x-ndjson');
  expect(await next(reader)).toEqual({ type: 'status', phase: 'reading' });
  await ready.promise;
  emit(first);
  expect(await next(reader)).toEqual({ type: 'partial', message: first });
  request.abort();
  expect((await reader.read()).done).toBe(true);

  const reconnected = connect(new AbortController().signal).body!.getReader();
  expect(await next(reconnected)).toEqual({ type: 'status', phase: 'reading' });
  expect(await next(reconnected)).toEqual({ type: 'partial', message: first });
  emit(second);
  expect(await next(reconnected)).toEqual({ type: 'partial', message: second });
  const jsonClient = sharedAnswer(key, generate);
  finish.resolve(final);
  expect(await next(reconnected)).toEqual({ type: 'complete', thread: final });
  expect((await reconnected.read()).done).toBe(true);
  expect(await jsonClient).toEqual(final);
  expect(calls).toBe(1);
});

test('structured failures end a stream without a saved answer, and internal details stay server-side', async () => {
  for (const [failure, expected] of [
    [new ApiError(409, 'conflict', 'A source has changed.'), { status: 409, code: 'conflict', message: 'A source has changed.' }],
    [new Error('provider secret'), { status: 500, code: 'internal_error', message: 'The request could not be completed.' }],
  ] as const) {
    const stream = answerStream(new AbortController().signal, async publish => { publish(first); throw failure; });
    const reader = stream.body!.getReader();
    expect((await next(reader)).type).toBe('status');
    expect((await next(reader)).type).toBe('partial');
    expect(await next(reader)).toEqual({ type: 'error', error: expected });
    expect((await reader.read()).done).toBe(true);
  }
});

test('reader cancellation detaches the subscriber without cancelling the accepted transaction', async () => {
  const entered = Promise.withResolvers<AbortSignal>(), finish = Promise.withResolvers<Thread>();
  const stream = answerStream(new AbortController().signal, async (_publish, subscription) => {
    entered.resolve(subscription);
    return finish.promise;
  });
  const reader = stream.body!.getReader();
  await next(reader);
  const subscription = await entered.promise;
  await reader.cancel();
  expect(subscription.aborted).toBe(true);
  finish.resolve(final);
  expect((await reader.read()).done).toBe(true);
});
