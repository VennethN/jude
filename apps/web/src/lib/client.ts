import { invalidateAll } from '$app/navigation';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

export async function api<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const form = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetch(path, {
    method,
    headers: body === undefined || form ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body)
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new ApiError(payload?.error?.code ?? 'request_failed', payload?.error?.message ?? response.statusText, response.status);
  return payload as T;
}

export async function write<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  const result = await api<T>(path, method, body);
  await invalidateAll();
  return result;
}
