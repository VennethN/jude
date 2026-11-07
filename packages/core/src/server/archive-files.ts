import { unzipSync } from 'fflate';
import { ApiError, invalid } from './validation';

export const limits = { zip: 48 * 1024 * 1024, expanded: 96 * 1024 * 1024, entries: 6000 };

export function readCaseFiles(bytes: Uint8Array): Record<string, Uint8Array> {
  const prefixes: string[] = [];
  let count = 0, total = 0;
  // Inspect the directory before expanding any data. A Finder-created ZIP may have one enclosing folder.
  unzipSync(bytes, { filter(entry) {
    if (++count > limits.entries || (total += entry.originalSize) > limits.expanded)
      throw new ApiError(413, 'file_too_large', 'The archive exceeds the import limit.');
    if (/^(?:(?!\.|__MACOSX\/)[^/\\:\x00]+\/)?manifest\.json$/.test(entry.name))
      prefixes.push(entry.name.slice(0, -'manifest.json'.length));
    return false;
  } });
  if (prefixes.length !== 1)
    throw new ApiError(422, 'archive_manifest', 'Choose an archive containing one Jude case manifest.');
  const prefix = prefixes[0];
  const seen = new Set<string>();
  const entries = unzipSync(bytes, { filter(entry) {
    if (!entry.name.startsWith(prefix)) return false;
    const path = entry.name.slice(prefix.length);
    const keep = path === 'case.json' || path === 'manifest.json' || path === 'audio/index.json'
      || /^originals\/[a-zA-Z0-9][\w-]*$/.test(path)
      || /^audio\/[\w-]+\/(recording\.(mp3|wav|m4a|mp4|mpeg|mpga|webm|ogg|flac)|[\w-]+\.pcm)$/.test(path)
      || /^documents\/[\w-]+\/(original\.(pdf|docx|md|txt)|viewer\.pdf)$/.test(path);
    if (keep && seen.has(path)) invalid('file');
    if (keep) seen.add(path);
    return keep;
  } });
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name.slice(prefix.length), data]));
}
