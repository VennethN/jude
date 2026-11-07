export function localPath(value: unknown, fallback = '/cases'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || /[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, 'https://jude.invalid');
    return url.origin === 'https://jude.invalid' ? url.pathname + url.search + url.hash : fallback;
  } catch { return fallback; }
}
