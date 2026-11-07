import { browser } from '$app/environment';
import { error, redirect } from '@sveltejs/kit';
import { mergeWorkspaceSync, type CaseSummary, type Workspace, type WorkspaceSync } from '@jude/core/domain';

type Entry<T> = { version: string; value: Promise<T>; cursor?: string };
const snapshots = new Map<string, Entry<Workspace>>();
const register = new Map<string, Entry<CaseSummary[]>>();
let scope = '';
let voice: { value: Promise<boolean>; until: number } | undefined;
let channel: BroadcastChannel | undefined;

function clear() {
  snapshots.clear();
  register.clear();
  voice = undefined;
}

function select(next: string) {
  if (scope !== next) {
    clear();
    scope = next;
  }
}

function loadVersion<T>(store: Map<string, Entry<T>>, id: string, version: string, read: () => Promise<T>) {
  if (!browser) return read();
  const current = store.get(id);
  store.delete(id);
  if (current?.version === version) {
    store.set(id, current);
    return current.value;
  }
  const entry = { version, value: read() };
  store.set(id, entry);
  if (store.size > 6) store.delete(store.keys().next().value!);
  // An older failing read must not evict a newer response for the same case.
  void entry.value.catch(() => {
    if (store.get(id) === entry) store.delete(id);
  });
  return entry.value;
}

export function checkWorkspaceScope(serverScope: string, parentScope: string, destination: () => string) {
  if (!browser) return;
  select(serverScope);
  // A different account or organisation can take over the HttpOnly cookie in another tab.
  if (serverScope !== parentScope) return reloadWorkspace(destination());
}

function reloadWorkspace(destination: string) {
  clear();
  window.location.replace(destination);
  return new Promise<never>(() => {});
}

async function read<T>(fetcher: typeof fetch, path: string, activeScope: string): Promise<T> {
  // The server also compares this public scope with the authenticated request's identity.
  const response = await fetcher(path, { headers: { 'x-jude-workspace': activeScope } });
  if (!response.ok) {
    if (browser && [401, 403, 404, 409].includes(response.status)) clear();
    if (browser && response.status === 409) return reloadWorkspace(window.location.href);
    if (response.status === 401) redirect(303, '/login');
    if (response.status === 403 || response.status === 404) return workspaceAccessLost();
    error(response.status, 'Gagal memuat ruang kerja.');
  }
  const value = await response.json();
  if (browser && scope !== activeScope) return reloadWorkspace(window.location.href);
  return value;
}

export function caseSnapshot(fetcher: typeof fetch, guard: { scope: string; id: string; version: string }) {
  const path = '/api/cases/' + encodeURIComponent(guard.id) + '/workspace';
  if (!browser) return read<WorkspaceSync>(fetcher, path + '?sync=1', guard.scope)
    .then(update => mergeWorkspaceSync(undefined, update));
  select(guard.scope);
  const previous = snapshots.get(guard.id);
  if (previous?.version === guard.version) return previous.value;
  let entry: Entry<Workspace>;
  const value = Promise.resolve().then(async () => {
    const before = previous ? await previous.value.catch(() => undefined) : undefined;
    if (scope !== guard.scope) return reloadWorkspace(window.location.href);
    let update = await read<WorkspaceSync>(fetcher,
      path + (before && previous?.cursor ? '?since=' + encodeURIComponent(previous.cursor) : '?sync=1'), guard.scope);
    let workspace: Workspace;
    try { workspace = mergeWorkspaceSync(before, update); }
    catch {
      // An unexpected ordering or local race is repaired with a full authorized snapshot.
      update = await read<WorkspaceSync>(fetcher, path + '?sync=1', guard.scope);
      workspace = mergeWorkspaceSync(undefined, update);
    }
    entry.cursor = update.cursor;
    return workspace;
  });
  entry = { version: guard.version, value };
  snapshots.delete(guard.id);
  snapshots.set(guard.id, entry);
  if (snapshots.size > 6) snapshots.delete(snapshots.keys().next().value!);
  void value.catch(() => {
    if (snapshots.get(guard.id) === entry) snapshots.delete(guard.id);
  });
  return value;
}

export function caseRegister(fetcher: typeof fetch, guard: { scope: string; version: string }) {
  return loadVersion(
    register,
    'cases',
    guard.version,
    async () => (await read<{ cases: CaseSummary[] }>(fetcher, '/api/cases', guard.scope)).cases,
  );
}

export async function voiceReady(fetcher: typeof fetch, kind: Workspace['caseRecord']['label']) {
  if (kind !== 'private') return false;
  if (browser && voice && voice.until > Date.now()) return voice.value;
  const value = fetcher('/api/voice-capability')
    .then(async (res) => res.ok && (await res.json()).transcription === true)
    .catch(() => false);
  if (!browser) return value;
  const entry = { value, until: Date.now() + 30000 };
  voice = entry;
  const available = await value;
  entry.until = Date.now() + (available ? 30000 : 5000);
  return available;
}

type Change = { kind: 'case'; id?: string } | { kind: 'session' } | { kind: 'identity'; scope: string };
function bus() {
  if (browser && typeof BroadcastChannel !== 'undefined')
    return (channel ??= new BroadcastChannel('jude-workspace'));
}
function forget(change: Change) {
  if (change.kind === 'case') {
    register.clear();
    if (change.id) snapshots.delete(change.id);
  } else clear();
}

export function workspaceRequest(method: string, path: string, status: number) {
  if (!browser) return;
  const casePath = /^\/api\/cases(?:\/([^/?]+))?/.exec(path);
  if ([401, 403, 404].includes(status)) {
    if (status === 401) {
      clear();
      if (casePath || path.startsWith('/api/me'))
        void reloadWorkspace('/login?next=' + encodeURIComponent(location.pathname + location.search));
    } else if (casePath?.[1]) forget({ kind: 'case', id: casePath[1] });
    return;
  }
  if (status < 200 || status >= 300 || method === 'GET') return;
  let change: Change;
  if (/^\/api\/(?:auth\/(?:login|signup|invite|demo|logout)|org\/switch)(?:$|\?)/.test(path)) {
    change = { kind: 'session' };
  } else if (casePath || path.startsWith('/api/demo/reseed') || path.startsWith('/api/billing/plan')) {
    change = { kind: 'case', id: casePath?.[1] };
  } else return;
  forget(change);
  // Other tabs only need an invalidation signal. Their own guards determine which case changed.
  bus()?.postMessage(change.kind === 'case' ? { kind: 'case' } : change);
}

export function watchWorkspace(activeScope: string, refresh: () => void) {
  select(activeScope);
  const transport = bus();
  const receive = ({ data }: MessageEvent<Change>) => {
    if (data.kind === 'identity' && data.scope === activeScope) return;
    forget(data);
    if (data.kind === 'case') refresh();
    else void reloadWorkspace(window.location.href);
  };
  // An SSR login, join or demo entry may have replaced the session outside the SPA.
  transport?.addEventListener('message', receive);
  transport?.postMessage({ kind: 'identity', scope: activeScope } satisfies Change);
  const visible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  const restored = (event: PageTransitionEvent) => {
    if (event.persisted) void reloadWorkspace(window.location.href);
  };
  window.addEventListener('focus', visible);
  window.addEventListener('pageshow', restored);
  document.addEventListener('visibilitychange', visible);
  return () => {
    transport?.removeEventListener('message', receive);
    window.removeEventListener('focus', visible);
    window.removeEventListener('pageshow', restored);
    document.removeEventListener('visibilitychange', visible);
  };
}

export function workspaceAccessLost(): Promise<never> {
  const destination = '/cases?notice=case-unavailable';
  // A denied Back navigation must also replace the old register stored in browser history.
  if (browser) return reloadWorkspace(destination);
  redirect(303, destination);
}
