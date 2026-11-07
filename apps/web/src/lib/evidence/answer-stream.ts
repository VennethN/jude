import type { AnswerStreamEvent, ChatMessage, Lang, Thread } from '@jude/core/domain';
import { ApiError } from '$lib/client';

export async function readAnswer(
  response: Response,
  lang: Lang,
  onPartial: (message: ChatMessage) => void,
  onProgress?: (phase: Extract<AnswerStreamEvent, {type: 'status'}>['phase']) => void,
): Promise<Thread> {
  const interrupted = () => new ApiError(
    'stream_interrupted',
    lang === 'id' ? 'Sambungan terputus. Coba lagi untuk melanjutkan jawaban.' : 'The connection was interrupted. Try again to recover the answer.',
    503,
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    throw new ApiError(payload?.error?.code ?? 'request_failed', payload?.error?.message ?? response.statusText, response.status);
  }
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return response.json();
  if (!response.body) throw interrupted();

  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  function accept(line: string) {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AnswerStreamEvent;
    if (event.type === 'status') { onProgress?.(event.phase); return; }
    if (event.type === 'partial' && event.message?.role === 'assistant') { onPartial(event.message); return; }
    if (event.type === 'complete' && Array.isArray(event.thread?.messages)) return event.thread;
    if (event.type === 'error') throw new ApiError(event.error.code, event.error.message, event.error.status);
    throw interrupted();
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop()!;
      for (const line of lines) {
        const thread = accept(line);
        if (thread) return thread;
      }
      if (done) throw interrupted();
    }
  } catch (error) {
    if (error instanceof ApiError || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw interrupted();
  } finally {
    // A terminal record is sufficient; a disconnected proxy need not close the HTTP stream.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export interface AnswerAttempt { digest: string; key: string; startCount: number }

function stored(slot: string): AnswerAttempt | undefined {
  try {
    const item = JSON.parse(sessionStorage.getItem(slot) ?? 'null');
    return typeof item?.digest === 'string' && typeof item.key === 'string' ? item : undefined;
  } catch { return; }
}

export function rememberAttempt(slot: string, attempt: AnswerAttempt) {
  try { sessionStorage.setItem(slot, JSON.stringify(attempt)); } catch { /* Storage is optional. */ }
}

export function forgetAttempt(slot: string, attempt: AnswerAttempt) {
  try { if (stored(slot)?.key === attempt.key) sessionStorage.removeItem(slot); } catch { /* Storage is optional. */ }
}

export async function claimAttempt(slot: string, input: string, startCount: number, previous?: AnswerAttempt): Promise<AnswerAttempt> {
  // Keep case questions, attachments and their names out of browser storage.
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  const digest = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
  const saved = stored(slot);
  const recovered = previous?.digest === digest ? previous : saved?.digest === digest ? saved : undefined;
  const attempt = {
    digest,
    key: recovered?.key ?? crypto.randomUUID(),
    startCount: Number.isInteger(recovered?.startCount) ? recovered!.startCount : startCount,
  };
  rememberAttempt(slot, attempt);
  return attempt;
}
