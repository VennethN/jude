import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readCaseFiles } from './archive-files';
import { repositoryRoot } from './workspace-paths';

let cached: Promise<Record<string, Uint8Array>> | undefined;

// Only this application-owned file can use stable case-scoped IDs and immutable originals.
export function bundledArchiveFiles() {
  cached ??= readFile(join(repositoryRoot(), 'packages/core/src/server/data/warehouse-v1.jude'))
    .then(readCaseFiles).catch(error => { cached = undefined; throw error; });
  return cached;
}

export function bundledOriginalKey(orgId: string, caseId: string, entry: string) {
  return 'bundled-warehouse-v1/' + orgId + '/' + caseId + '/' + entry;
}

// The case UUID makes each attachment row unique. Its immutable bytes ship with the app.
export function bundledOriginalEntry(key: string) {
  return /^bundled-warehouse-v1\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(documents\/[a-zA-Z0-9_-]+\/(?:original\.(?:pdf|docx|txt|md)|viewer\.pdf))$/.exec(key)?.[1];
}
