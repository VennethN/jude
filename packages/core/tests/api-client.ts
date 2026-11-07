import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { endpoint } from '../src/server/api';
import { sessionFromToken } from '../src/server/auth';

type RequestEvent = Parameters<typeof endpoint>[0];

export function browser() {
  const cookies = new Map<string, string>(),
    ip = randomUUID();
  async function request(path: string, method = 'GET', data?: unknown, key?: string, accept?: string) {
    const url = new URL('/api/' + path, 'http://localhost:5173'),
      headers = new Headers();
    let body: FormData | string | undefined;
    if (data instanceof FormData) body = data;
    else if (data !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(data);
    }
    if (key) headers.set('idempotency-key', key);
    if (accept) headers.set('accept', accept);
    const event = {
      request: new Request(url, { method, headers, body }),
      url,
      params: { path: path.split('?')[0] },
      locals: { session: await sessionFromToken(cookies.get('jude_session')) },
      getClientAddress: () => ip,
      cookies: {
        get: (k: string) => cookies.get(k),
        set: (k: string, v: string) => cookies.set(k, v),
        delete: (k: string) => cookies.delete(k),
      },
    } as unknown as RequestEvent;
    return endpoint(event);
  }
  async function ok<T>(path: string, method = 'GET', data?: unknown, key?: string): Promise<T> {
    const response = await request(path, method, data, key);
    const value = await response.json();
    expect(response.status, JSON.stringify(value)).toBe(200);
    return value as T;
  }
  return { request, ok, cookies };
}
