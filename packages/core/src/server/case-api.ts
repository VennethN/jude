import { transcriptionAvailable } from './voice-capabilities';
import { removeSourceIn, restoreSourceIn, retentionMs } from './retention';
import { retainedMarker } from './retained-evidence';
import { createHash, randomUUID } from 'node:crypto';
import type { CoreRequest } from './request';
import type { ChatMessage, ContextRef, SessionInfo, Thread, Workspace } from '../domain';
import { needsReview } from '../domain';
import { billing, checkQuota, meter } from './billing';
import {
  changeIn,
  idempotent,
  mutateWorkspace,
  orgLock,
  patchCase,
  readWorkspace,
  workspaceIn,
} from './cases';
import { transaction, type Database } from './db';
import { original, uploadDocument } from './documents';
import {
  addBoard,
  addBoardCard,
  addConnection,
  contextsOf,
  hasCitation,
  patchConnection,
  patchFinding,
  patchStatement,
  updateBoard,
} from './evidence';
import { addHearing, endHearing, importHearing, patchHearing, patchSpeaker, startHearing } from './hearings';
import {
  ApiError,
  bilingual,
  bool,
  choice,
  conflict,
  invalid,
  missing,
  object,
  required,
  string,
  unavailable,
  type Fields,
} from './validation';
import { jsonFields } from './request';
import { authorizeCase, caseAccess, listMembers, setCaseMember } from './access';
import { answerQuestion, sourcePool } from './providers/assistant';
import { ASSISTANT_QUESTION_LIMIT, type AssistantStage, type LegalSearchStatus } from '../domain';
import { answerStream, sharedAnswer, cancelAnswer } from './answer-stream';
import { mergeEvidenceRanks, semanticMatches, type SourceRef } from './providers/semantic-retrieval';
import { isLawQuestion } from './providers/legal-query';
import { answerLawQuestion, discoverLegal, legalDiscoveryMode, retainLegal } from './providers/pasal';

const groups = [
  'hearings',
  'speakers',
  'statements',
  'findings',
  'documents',
  'passages',
  'connections',
  'boards',
  'threads',
  'legal',
  'replies',
] as const;
export function caseHits(w: Workspace, query: string, semantic: SourceRef[] = []) {
  const term = query.toLocaleLowerCase().trim();
  if (term.length < 2) return [];
  const base = '/case/' + encodeURIComponent(w.caseRecord.id);
  const hits = [
    ...w.hearings.map((h) => ({
      kind: 'hearing',
      id: h.id,
      text: h.title.id + ' / ' + h.title.en + ' ' + h.date,
      url: base + '/hearings/' + h.id,
    })),
    ...w.documents.map((d) => ({
      kind: 'document',
      id: d.id,
      text: d.title,
      url: base + '/documents/' + d.id,
    })),
    ...w.findings.map((f) => ({
      kind: 'finding',
      id: f.id,
      text: f.title.id + ' / ' + f.title.en + ' ' + (f.said ?? '') + ' ' + f.question,
      url: base + '/findings/' + f.id,
    })),
    ...w.passages.map((p) => ({
      kind: 'passage',
      id: p.id,
      text: p.text,
      url: base + '/documents/' + p.docId + '?p=' + p.id,
    })),
    ...w.statements.map((s) => ({
      kind: 'statement',
      id: s.id,
      text: s.text,
      url: base + '/hearings/' + s.hearingId + '?s=' + s.id,
    })),
  ];
  const lexical = hits.filter(h => h.text.toLocaleLowerCase().includes(term));
  return mergeEvidenceRanks(lexical, semantic, hits, 80)
    .map((h) => {
      const start = Math.max(0, h.text.toLocaleLowerCase().indexOf(term) - 45);
      return { ...h, snippet: h.text.slice(start, start + 180) };
    });
}
async function eventStream(event: CoreRequest, org: string, caseId: string) {
  const tokenHash = createHash('sha256')
    .update(event.cookies.get('jude_session') ?? '')
    .digest('hex');
  let version = Number(event.request.headers.get('last-event-id') ?? 0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false,
    beats = 0;
  const abort = () => {
    closed = true;
    clearTimeout(timer);
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (text: string) => controller.enqueue(new TextEncoder().encode(text));
      const ping = async () => {
        if (closed) return;
        try {
          const [row] = await transaction((db) => db.query<{ version: number }>(
            'SELECT c.version FROM cases c JOIN workspace_case_members cm ON cm.case_id=c.id ' +
            'JOIN memberships m ON m.org_id=c.org_id AND m.user_id=cm.user_id ' +
            'JOIN sessions s ON s.user_id=m.user_id AND s.org_id=m.org_id ' +
            'WHERE c.id=$1 AND c.org_id=$2 AND cm.user_id=$3 AND c.deleted_at IS NULL AND s.token_hash=$4 AND s.expires_at>$5',
            [caseId, org, event.locals.session!.user.id, tokenHash, Date.now()],
          ));
          if (closed) return;
          if (!row) {
            send('event: case.access-lost\ndata: {}\n\n');
            abort();
            controller.close();
            return;
          }
          const v = row.version;
          if (version !== v) {
            version = v;
            send(
              'id: ' + v + '\nevent: case.updated\ndata: ' + JSON.stringify({ caseId, version: v }) + '\n\n',
            );
          } else if (++beats % 10 === 0) send(': keep-alive\n\n');
          timer = setTimeout(() => {
            void ping();
          }, 1500);
        } catch {
          if (!closed) {
            abort();
            controller.close();
          }
        }
      };
      event.request.signal.addEventListener(
        'abort',
        () => {
          if (!closed) {
            abort();
            controller.close();
          }
        },
        { once: true },
      );
      void ping();
    },
    cancel() {
      abort();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'private, no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}

async function caseState(
  db: Database,
  org: string,
  id: string,
  action: 'delete' | 'restore' | 'archive' | 'unarchive',
) {
  await orgLock(db, org);
  const [c] = await db.query<{
    record: string;
    archived: number;
    deleted_at: number | string | null;
    synthetic: number;
  }>('SELECT record,archived,deleted_at,synthetic FROM cases WHERE id=$1 AND org_id=$2' + db.forUpdate, [
    id,
    org,
  ]);
  if (!c || (c.deleted_at && (action !== 'restore' || Number(c.deleted_at) + retentionMs() < Date.now())))
    missing();
  if (
    ((action === 'unarchive' && c.archived) || (action === 'restore' && c.deleted_at && !c.archived)) &&
    !c.synthetic
  )
    await checkQuota(db, org, 'cases', 1);
  if (action === 'restore' && c.deleted_at) {
    const [stored] = await db.query<{ size: string | number; boards: string | number }>(
      "SELECT (SELECT COUNT(*) FROM case_entities WHERE case_id=$1 AND kind='boards') AS boards," +
        "COALESCE(SUM(n),0) AS size FROM (SELECT a.byte_length AS n FROM attachments a WHERE a.case_id=$1 AND a.kind IN ('original','audio') " +
        "AND NOT EXISTS (SELECT 1 FROM case_trash x WHERE x.case_id=a.case_id AND x.id=a.entity_id AND x.kind=CASE WHEN a.kind='audio' THEN 'hearings' ELSE 'documents' END) " +
        "UNION ALL SELECT t.bytes AS n FROM voice_turns t WHERE t.case_id=$1 AND t.object_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM case_trash x WHERE x.case_id=t.case_id AND x.id=t.hearing_id AND x.kind='hearings')) AS items",
      [id],
    );
    if (Number(stored.size)) await checkQuota(db, org, 'storage', Number(stored.size) / 1e9);
    if (Number(stored.boards)) await checkQuota(db, org, 'boards', Number(stored.boards));
  }
  if (action === 'delete') {
    await db.query('UPDATE cases SET deleted_at=$1,version=version+1 WHERE id=$2', [Date.now(), id]);
    await db.query('DELETE FROM semantic_evidence WHERE case_id=$1', [id]);
    await db.query('DELETE FROM semantic_case_state WHERE case_id=$1', [id]);
  } else if (action === 'restore')
    await db.query('UPDATE cases SET deleted_at=NULL,version=version+1 WHERE id=$1', [id]);
  else if (Boolean(c.archived) !== (action === 'archive')) {
    const record = JSON.parse(c.record);
    if (action === 'archive') record.archivedAt = new Date().toISOString();
    else delete record.archivedAt;
    record.archived = action === 'archive';
    record.updated = new Date().toISOString();
    await db.query('UPDATE cases SET archived=$1,record=$2,updated_at=$3,version=version+1 WHERE id=$4', [
      Number(record.archived),
      JSON.stringify(record),
      Date.now(),
      id,
    ]);
  }
  return { ok: true };
}
const trashable = ['threads', 'boards', 'connections', 'documents', 'hearings'] as const;
type TrashKind = (typeof trashable)[number];
async function removeItem(db: Database, org: string, caseId: string, kind: TrashKind, id: string) {
  if (kind === 'documents' || kind === 'hearings') return removeSourceIn(db, org, caseId, kind, id);
  const removed = await changeIn(db, org, caseId, (w) => {
    const items = w[kind] as { id: string }[];
    const index = items.findIndex((v) => v.id === id);
    if (index < 0) missing();
    return items.splice(index, 1)[0];
  });
  await db.query(
    'INSERT INTO case_trash(case_id,kind,id,body,deleted_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(case_id,kind,id) DO UPDATE SET body=excluded.body,deleted_at=excluded.deleted_at',
    [caseId, kind, id, JSON.stringify(removed), Date.now()],
  );
  return { ok: true, id };
}
async function restoreItem(db: Database, org: string, caseId: string, kind: TrashKind, id: string) {
  await orgLock(db, org);
  const [item] = await db.query<{ body: string }>(
    'SELECT body FROM case_trash WHERE case_id=$1 AND kind=$2 AND id=$3 AND deleted_at>=$4',
    [caseId, kind, id, Date.now() - retentionMs()],
  );
  if (!item) missing();
  if ((kind === 'documents' || kind === 'hearings') && item.body === retainedMarker)
    return restoreSourceIn(db, org, caseId, kind, id);
  if (kind === 'boards') await checkQuota(db, org, 'boards', 1);
  const data = JSON.parse(item.body);
  await changeIn(db, org, caseId, (w) => {
    (w[kind] as { id: string }[]).push(data);
  });
  await db.query('DELETE FROM case_trash WHERE case_id=$1 AND kind=$2 AND id=$3', [caseId, kind, id]);
  return data;
}
async function postMessage(
  session: SessionInfo,
  caseId: string,
  threadId: string,
  f: Fields,
  key: string | null,
  request: Request,
) {
  const org = session.organization.id,
    text = string(f.text ?? f.question, 'text', ASSISTANT_QUESTION_LIMIT),
    lang = choice(f.lang ?? session.prefs.lang ?? 'id', ['id', 'en'], 'lang');
  const withLegal = f.withLegal === undefined ? true : bool(f.withLegal, 'withLegal');
  const scope = caseId + '/threads/' + threadId + '/messages';
  if (key) string(key, 'Idempotency-Key', 100);
  const before = await transaction<{ cached: Thread } | { workspace: Workspace; contexts: ContextRef[]; length: number; history: ChatMessage[] }>(async (db) => {
    await orgLock(db, org);
    const w = await workspaceIn(db, org, caseId);
    const thread = required(w.threads, (t) => t.id === threadId);
    if (key) {
      const [prior] = await db.query<{ result: string }>(
        'SELECT result FROM idempotency WHERE org_id=$1 AND scope=$2 AND key=$3',
        [org, scope, key],
      );
      if (prior) return { cached: JSON.parse(prior.result) as Thread };
    }
    await checkQuota(db, org, 'questions', 1);
    return { workspace: w, contexts: contextsOf(w, f.contexts), length: thread.messages.length, history: thread.messages };
  });
  async function generate(publish: (message: ChatMessage) => void, signal?: AbortSignal, progress?: (stage: AssistantStage) => void): Promise<Thread> {
    if ('cached' in before) return before.cached;
    const { workspace, contexts } = before;
    let legalStatus: LegalSearchStatus | undefined;
    const options = { signal, status: (value: LegalSearchStatus) => { legalStatus = value; } };
    if (withLegal && isLawQuestion(text)) progress?.('legal');
    const legalQuestion = await answerLawQuestion(workspace, text, contexts, lang, withLegal, options);
    const answer: ChatMessage = legalQuestion?.answer ?? await answerQuestion(
      workspace, text, contexts, lang, !session.user.guest && workspace.caseRecord.label === 'private',
      org, publish, { signal, progress, history: before.history },
    );
    signal?.throwIfAborted();
    if (answer.mode === 'sources-only') publish(answer);
    if (withLegal && !legalQuestion) progress?.('legal');
    const discovered = legalQuestion?.discoveries ?? (withLegal
      ? await discoverLegal(workspace, text, [...contexts, ...(answer.citations ?? [])], options) : []);
    if (legalStatus) answer.legalStatus = legalStatus;
    signal?.throwIfAborted();
    progress?.('saving');
    return transaction((db) =>
      idempotent(db, org, scope, key, async () => {
        signal?.throwIfAborted();
        await caseAccess(db, session, caseId, 'write');
        await checkQuota(db, org, 'questions', 1);
        const result = await changeIn(db, org, caseId, (w) => {
          const thread = required(w.threads, (t) => t.id === threadId);
          if (thread.messages.length !== before.length)
            conflict('Another question was added. Reload this conversation.');
          contextsOf(w, contexts);
          if (answer.citations?.some((c) => !hasCitation(w, c)))
            conflict('A cited source has changed. Ask the question again.');
          const original = sourcePool(workspace, [{ kind: 'case' }], lang);
          const current = sourcePool(w, [{ kind: 'case' }], lang);
          if (answer.citations?.some(c => original.find(s=>s.kind===c.kind&&s.id===c.id)?.text !== current.find(s=>s.kind===c.kind&&s.id===c.id)?.text))
            conflict('A cited source has changed. Ask the question again.');
          const legal = retainLegal(w, discovered);
          if (thread.messages.length === 0) thread.title = thread.title || text.slice(0, 80);
          thread.sample = false;
          thread.updated = Date.now();
          thread.messages.push(
            { id: randomUUID(), role: 'user', text, contexts },
            { ...answer, ...(legal.length ? { legal } : {}), id: randomUUID(), role: 'assistant' },
          );
          return thread;
        });
        await meter(db, org, 'questions', 1);
        return result;
      }),
    );
  }
  const cacheKey = key ? JSON.stringify([org, scope, key]) : undefined;
  const acceptsStream = request.headers.get('accept')?.split(',').some(
    (value) => value.trim().split(';')[0] === 'application/x-ndjson',
  );
  return acceptsStream
    ? answerStream(request.signal, (publish, signal, progress) => sharedAnswer(cacheKey, generate, publish, signal, progress))
    : sharedAnswer(cacheKey, generate, undefined, request.signal);
}
async function liveQuota(db: Database, org: string, w: Workspace) {
  if (w.caseRecord.label === 'synthetic') return;
  const limits = await checkQuota(db, org, 'hours', 1 / 3600);
  if (limits.planId === 'basic')
    throw new ApiError(402, 'feature_not_in_plan', 'Live transcription needs an eligible plan.', {
      feature: 'live_transcription',
    });
}
export async function caseRequest(event: CoreRequest, session: SessionInfo, caseId: string, path: string[]) {
  const org = session.organization.id,
    [resource, id, act] = path,
    method = event.request.method,
    key = event.request.headers.get('idempotency-key');
  if (path.length > 3) missing();
  const managing =
    (resource === 'members' && method !== 'GET') ||
    (!resource && method === 'DELETE') ||
    (resource === 'restore' && method === 'POST');
  await authorizeCase(
    session,
    caseId,
    managing ? 'manage' : method === 'GET' ? 'read' : 'write',
    resource === 'restore',
  );
  if (resource === 'members' && !act) {
    if (method === 'GET' && !id) return transaction((db) => listMembers(db, session, caseId));
    if (id && (method === 'PUT' || method === 'DELETE')) {
      const fields = method === 'DELETE' ? {} : await jsonFields(event.request);
      return transaction((db) => setCaseMember(db, session, caseId, id, fields.role, method === 'DELETE'));
    }
    missing();
  }
  if (method === 'GET') {
    if (resource === 'events' && !id) return eventStream(event, org, caseId);
    if (resource === 'documents' && id && (act === 'original' || act === 'viewer'))
      return original(org, caseId, id, act);
    if (resource === 'export' && !id) {
      const { exportArchive } = await import('./archive');
      return exportArchive(org, caseId);
    }
    const w = await readWorkspace(org, caseId);
    if (!resource || (resource === 'workspace' && !id)) return { ...w, legalDiscovery: legalDiscoveryMode(w) };
    if (resource === 'shell' && !id)
      return {
        case: w.caseRecord,
        counts: { documents: w.documents.length, needsLook: w.findings.filter(needsReview).length },
        live: w.hearings.find((h) => h.mode === 'live') ?? null,
      };
    if (resource === 'bookmarks' && !id) return w.statements.filter((s) => s.flagged);
    if (resource === 'search' && !id) {
      const query = (event.url.searchParams.get('q') ?? '').trim().slice(0, 2000);
      const semantic = query.length >= 3 && !session.user.guest ? await semanticMatches(w, org, query) : [];
      return { hits: caseHits(w, query, semantic) };
    }
    if (resource === 'evidence' && !id)
      return {
        statements: w.statements,
        passages: w.passages,
        findings: w.findings,
        connections: w.connections,
      };
    const kind = groups.find((g) => g === resource);
    if (kind && !act) return id ? required(w[kind] as { id: string }[], (item) => item.id === id) : w[kind];
    if (resource === 'documents' && act === 'text') return w.passages.filter((p) => p.docId === id);
    missing();
  }
  if (!resource && method === 'DELETE') return transaction((db) => caseState(db, org, caseId, 'delete'));
  if (['archive', 'unarchive', 'restore'].includes(resource) && method === 'POST' && !id)
    return transaction((db) => caseState(db, org, caseId, resource as 'archive' | 'unarchive' | 'restore'));
  if (resource === 'export' && method === 'POST' && !id) {
    const account = await transaction((db) => billing(db, org));
    if (account.planId === 'basic')
      throw new ApiError(402, 'feature_not_in_plan', 'Export requires an eligible plan.', {
        feature: 'jude_export',
      });
    return { url: '/api/cases/' + caseId + '/export', status: 'ready' };
  }
  if (resource === 'documents' && method === 'POST' && !id)
    return uploadDocument(org, caseId, await event.request.formData(), key);
  if (resource === 'hearings' && id === 'import' && act === 'preview' && method === 'POST') {
    await readWorkspace(org, caseId);
    const { previewTranscript } = await import('./transcript');
    return previewTranscript(await event.request.formData());
  }
  const trash = trashable.find((t) => t === resource);
  if (trash && id && !act && method === 'DELETE')
    return transaction((db) => removeItem(db, org, caseId, trash, id));
  if (trash && id && act === 'restore' && method === 'POST')
    return transaction((db) => restoreItem(db, org, caseId, trash, id));
  if (resource === 'threads' && id && act === 'cancel' && method === 'POST') {
    const attempt = string(key, 'Idempotency-Key', 100);
    return { cancelled: cancelAnswer(JSON.stringify([org, caseId + '/threads/' + id + '/messages', attempt])) };
  }
  const f = await jsonFields(event.request);
  if (!resource && method === 'PATCH') return mutateWorkspace(org, caseId, (w) => patchCase(w, f));
  if (resource === 'threads' && id && act === 'messages' && method === 'POST')
    return postMessage(session, caseId, id, f, key, event.request);
  const startingHearing =
    resource === 'hearings' && method === 'POST' && (f.flow === 'live' || act === 'start');
  const voiceReady = startingHearing && !session.user.guest && (await transcriptionAvailable());
  return transaction((db) =>
    idempotent(db, org, caseId + '/' + path.join('/') + '/' + method, key, async () => {
      if (resource === 'boards' && id === 'first' && !act && method === 'POST') {
        await orgLock(db, org);
        const current = await workspaceIn(db, org, caseId, true);
        if (!current.boards.length) await checkQuota(db, org, 'boards', 1);
        const card = f.card === undefined ? undefined : object(f.card, 'card');
        return changeIn(db, org, caseId, (workspace) => {
          const board = workspace.boards[0] ?? addBoard(workspace, { name: f.name });
          return card ? addBoardCard(workspace, board.id, card) : board;
        });
      }
      if (resource === 'boards' && !id && method === 'POST') await checkQuota(db, org, 'boards', 1);
      if (startingHearing) {
        await orgLock(db, org);
        const w = await workspaceIn(db, org, caseId);
        if (
          f.recordingPermission !== true ||
          f.closed === true ||
          w.hearings.find((h) => h.id === id)?.closed
        )
          throw new ApiError(
            422,
            'recording_permission',
            'Recording requires judicial permission in an open hearing.',
          );
        if (w.caseRecord.label === 'private' && !voiceReady) unavailable('transcribe');
        await liveQuota(db, org, w);
        if (w.caseRecord.label === 'private') {
          const active = await db.query<{ body: string }>(
            "SELECT e.body FROM case_entities e JOIN cases c ON e.case_id=c.id WHERE c.org_id=$1 AND c.synthetic=0 AND c.deleted_at IS NULL AND e.kind='hearings'",
            [org],
          );
          if (
            active.some((row) => {
              const h = JSON.parse(row.body);
              return h.mode === 'live' && h.recordingPermission?.by === session.user.id;
            })
          )
            throw new ApiError(409, 'already_recording', 'You already have a live hearing.');
        }
      }
      if (resource === 'hearings' && method === 'POST' && act === 'end') {
        const w = await workspaceIn(db, org, caseId, true);
        const hearing = required(w.hearings, (h) => h.id === id);
        if (w.caseRecord.label !== 'synthetic' && hearing.recordingPermission?.by !== session.user.id)
          throw new ApiError(403, 'forbidden', 'Only the recording lawyer may end this hearing.');
        const pending = await db.query(
          'SELECT turn_id FROM voice_pending_transcripts WHERE case_id=$1 AND hearing_id=$2 LIMIT 1',
          [caseId, id],
        );
        if (pending.length) throw new ApiError(409, 'audio_pending', 'Finish sending the pending audio before ending this hearing.');
      }
      const result = await changeIn(db, org, caseId, (w) => {
        if (resource === 'hearings') {
          if (method === 'POST' && id === 'import' && !act) return importHearing(w, f, session.user.id);
          if (method === 'POST' && !id) return addHearing(w, f, session.user.id);
          if (method === 'POST' && act === 'start') return startHearing(w, id, f, session.user.id);
          if (method === 'POST' && act === 'end') {
            const hearing = required(w.hearings, (h) => h.id === id);
            if (w.caseRecord.label !== 'synthetic' && hearing.recordingPermission?.by !== session.user.id)
              throw new ApiError(403, 'forbidden', 'Only the recording lawyer may end this hearing.');
            return endHearing(w, id);
          }
          if (method === 'PATCH' && id && !act) return patchHearing(w, id, f);
        }
        if (resource === 'speakers' && method === 'PATCH' && id && !act) return patchSpeaker(w, id, f);
        if (resource === 'statements' && method === 'PATCH' && id && !act) return patchStatement(w, id, f);
        if (resource === 'findings' && method === 'PATCH' && id && !act) return patchFinding(w, id, f);
        if (resource === 'connections' && method === 'PATCH' && id && !act) return patchConnection(w, id, f);
        if (resource === 'connections' && method === 'POST' && !id) return addConnection(w, f);
        if (resource === 'boards' && method === 'POST' && !id) return addBoard(w, f);
        if (resource === 'boards' && method === 'PUT' && id && !act) return updateBoard(w, id, f);
        if (resource === 'boards' && method === 'POST' && act === 'cards') return addBoardCard(w, id, f);
        if (resource === 'documents' && method === 'PATCH' && id && !act) {
          const doc = required(w.documents, (d) => d.id === id);
          if ('title' in f) doc.title = string(f.title, 'title', 240);
          if ('kind' in f) doc.kind = bilingual(f.kind, 'kind');
          return doc;
        }
        if (resource === 'threads' && method === 'POST' && !id) {
          const t: Thread = {
            id: randomUUID(),
            caseId,
            title: string(f.title, 'title', 160, true),
            updated: Date.now(),
            messages: [],
          };
          w.threads.unshift(t);
          return t;
        }
        if (resource === 'threads' && method === 'PATCH' && id && !act) {
          const t = required(w.threads, (t) => t.id === id);
          t.title = string(f.title, 'title', 160);
          t.updated = Date.now();
          return t;
        }
        missing();
      });
      return result;
    }),
  );
}
