import { requestErrorText } from './request-errors';
import { invalidateAll } from '$app/navigation';

export class ApiError extends Error {
  constructor(
    public code: string,
    readonly serverMessage: string,
    public status: number,
  ) {
    super(requestErrorText(code, typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'id'));
  }
}

export async function api<T = unknown>(
  path: string,
  method = 'GET',
  body?: unknown,
  headers?: HeadersInit,
): Promise<T> {
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !form) requestHeaders.set('content-type', 'application/json');
  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new ApiError(
      payload?.error?.code ?? 'request_failed',
      payload?.error?.message ?? response.statusText,
      response.status,
    );
  return payload as T;
}

export async function write<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const result = await api<T>(path, method, body);
  await invalidateAll();
  return result;
}
