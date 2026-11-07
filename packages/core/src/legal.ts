/** Preserve the public locator for a regulation or article returned by Pasal.id. */
export function pasalSourceUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://pasal.id' || url.username || url.password) return;
    if (!/^\/(?:en\/)?peraturan\/[a-z0-9-]+\/[a-z0-9-]+(?:\/pasal-[a-z0-9-]+)?\/?$/i.test(url.pathname)) return;
    url.search = '';
    if (url.hash && !/^#(?:pasal|node)-[a-z0-9-]+$/i.test(url.hash)) url.hash = '';
    return url.href;
  } catch {
    return;
  }
}
