export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function missing(): never {
  throw new ApiError(404, 'not_found', 'Item not found.');
}
export function invalid(field: string): never {
  throw new ApiError(422, 'validation', 'Check the fields and try again.', { fields: [field] });
}
export function conflict(message: string): never {
  throw new ApiError(409, 'conflict', message);
}
export function unavailable(provider: string): never {
  throw new ApiError(503, 'provider_unavailable', 'The provider is unavailable.', { provider });
}
export function object(value: unknown, field = 'body'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
export function string(value: unknown, field: string, max = 240, optional = false) {
  if (value == null && optional) return '';
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) invalid(field);
  return value.trim();
}
export function archiveId(value: unknown, field = 'id') {
  const id = string(value, field, 120);
  if (!/^[a-zA-Z0-9][\w-]*$/.test(id) || ['constructor', 'prototype', '__proto__'].includes(id))
    invalid(field);
  return id;
}
export function bool(value: unknown, field: string) {
  if (typeof value !== 'boolean') invalid(field);
  return value;
}
export function number(value: unknown, field: string, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(field);
  return value;
}
export function choice<const T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) invalid(field);
  return value as T;
}
export function bilingual(value: unknown, field: string, max = 400, optional = false) {
  if (typeof value === 'string' || value == null) {
    const text = string(value, field, max, optional);
    return { id: text, en: text };
  }
  const entry = object(value, field);
  return { id: string(entry.id, field, max, optional), en: string(entry.en, field, max, optional) };
}
export function date(value: unknown) {
  const day = string(value, 'date', 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    isNaN(Date.parse(day)) ||
    new Date(day).toISOString().slice(0, 10) !== day
  )
    invalid('date');
  return day;
}
export function email(value: unknown) {
  const address = string(value, 'email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) invalid('email');
  return address;
}
export function required<T>(rows: T[], predicate: (value: T) => boolean) {
  return rows.find(predicate) ?? missing();
}
export type Fields = Record<string, unknown>;
