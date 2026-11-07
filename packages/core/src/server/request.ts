import type { SessionInfo } from '../domain';
import { ApiError, invalid, object, type Fields } from './validation';

interface CookieSettings {
  path: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  maxAge?: number;
}

export interface CoreRequest {
  request: Request;
  url: URL;
  params: Record<string,string|undefined>;
  locals: {session: SessionInfo|null};
  cookies: {
    get(name:string): string|undefined;
    set(name:string,value:string,settings:CookieSettings): void;
    delete(name:string,settings:CookieSettings): void;
  };
  getClientAddress():string;
}

export async function jsonFields(request: Request): Promise<Fields> {
  if (request.headers.get('content-length') === '0' || !request.body) return {};
  if ((request.headers.get('content-type') ?? '').split(';')[0] !== 'application/json') {
    const text = await request.text();
    if (!text.trim()) return {};
    invalid('content-type');
  }
  let value: unknown;
  try {
    const text = await request.text();
    if (!text) return {};
    if (text.length > 8 * 1024 * 1024) throw new ApiError(413, 'file_too_large', 'The request is too large.');
    value = JSON.parse(text);
  } catch (e) {
    if (e instanceof ApiError) throw e;
    invalid('body');
  }
  return object(value);
}
