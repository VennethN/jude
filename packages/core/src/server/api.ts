import { randomUUID } from 'node:crypto';
import { jsonFields, type CoreRequest } from './request';
import { planCatalog } from '../plans';
import {
  acceptInvite,
  beginDemo,
  clientId,
  invite,
  login,
  logout,
  rateLimit,
  requireSession,
  removeMember,
  switchOrganization,
  resetConfirm,
  resetRequest,
  setPrefs,
  signup,
} from './auth';
import { applyPlan, billing, checkQuota } from './billing';
import {
  emptyWorkspace,
  idempotent,
  insertWorkspace,
  listCases,
  makeCase,
  orgLock,
  workspaceIn,
} from './cases';
import { caseHits, caseRequest } from './case-api';
import { transaction } from './db';
import {
  ApiError,
  email,
  invalid,
  missing,
  number,
  string,
  unavailable,
} from './validation';

async function handle(event: CoreRequest) {
  const path = (event.params.path ?? '').split('/').filter(Boolean);
  const route = path.join('/'),
    method = event.request.method;
  if (route === 'plans' && method === 'GET') return planCatalog;
  if (route.startsWith('auth/') && method === 'POST') {
    if (route === 'auth/demo') return beginDemo(event);
    if (route === 'auth/logout') return logout(event);
    const f = await jsonFields(event.request);
    switch (route) {
      case 'auth/signup':
        return signup(event, f);
      case 'auth/login':
        return login(event, f);
      case 'auth/reset':
        return resetRequest(event, f);
      case 'auth/reset/confirm':
        return resetConfirm(f);
      case 'auth/invite':
        return acceptInvite(event, f);
    }
  }
  if (route === 'sales/contact' && method === 'POST') {
    const f = await jsonFields(event.request);
    if (f.website) return { ok: true };
    const contact = {
      name: string(f.name, 'name', 100),
      email: email(f.email),
      org: string(f.org, 'org', 150, true),
      size:
        f.size === undefined || f.size === null || f.size === ''
          ? undefined
          : number(Number(f.size), 'size', 1, 100000),
      message: string(f.message, 'message', 4000, true),
      lang: f.lang === 'en' ? 'en' : 'id',
    };
    return transaction(async (db) => {
      await rateLimit(db, 'contact', clientId(event), 5, 3600000);
      await db.query('INSERT INTO sales_contacts(id,body,created_at) VALUES($1,$2,$3)', [
        randomUUID(),
        JSON.stringify(contact),
        Date.now(),
      ]);
      return { ok: true };
    });
  }
  const session = requireSession(event),
    org = session.organization.id;
  if (route === 'me' && method === 'GET') return session;
  if (route === 'me/prefs' && method === 'PATCH') return setPrefs(event, await jsonFields(event.request));
  if (route === 'billing' && method === 'GET') return transaction((db) => billing(db, org));
  if (route === 'billing/plan' && method === 'POST') {
    const f = await jsonFields(event.request);
    return transaction((db) => applyPlan(db, session, f));
  }
  if (route === 'billing/portal' && method === 'POST') unavailable('billing');
  if (route === 'billing/invoices' && method === 'GET') return { invoices: [] };
  if (route === 'orgs' && method === 'GET')
    return {
      organizations: await transaction((db) =>
        db.query(
          'SELECT o.id,o.name,m.role FROM memberships m JOIN organizations o ON o.id=m.org_id WHERE m.user_id=$1 ORDER BY o.name,o.id',
          [session.user.id],
        ),
      ),
    };
  if (route === 'org/switch' && method === 'POST')
    return switchOrganization(event, await jsonFields(event.request));
  if (route === 'org/members' && method === 'GET') {
    if (session.role === 'member')
      throw new ApiError(403, 'forbidden', 'An account administrator manages members.');
    return {
      members: await transaction((db) =>
        db.query(
          'SELECT u.id,u.name,u.email,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=$1 ORDER BY u.name,u.id',
          [org],
        ),
      ),
    };
  }
  if (path.length === 3 && path[0] === 'org' && path[1] === 'members' && method === 'DELETE')
    return transaction((db) => removeMember(db, session, path[2]));
  if (route === 'org/invitations' && method === 'POST') return invite(event, await jsonFields(event.request));
  if (route === 'org' && method === 'GET') return session.organization;
  if (route === 'org' && method === 'PATCH') {
    if (session.role === 'member')
      throw new ApiError(403, 'forbidden', 'An account administrator can rename this organisation.');
    const name = string((await jsonFields(event.request)).name, 'name', 150);
    await transaction((db) => db.query('UPDATE organizations SET name=$1 WHERE id=$2', [name, org]));
    return { id: org, name };
  }
  if (route === 'search' && method === 'GET') {
    const query = event.url.searchParams.get('q') ?? '';
    if (query.trim().length < 2) return { cases: [] };
    return transaction(async (db) => {
      const cases = await db.query<{ id: string }>(
        'SELECT c.id FROM cases c JOIN workspace_case_members cm ON cm.case_id=c.id WHERE c.org_id=$1 AND cm.user_id=$2 AND c.deleted_at IS NULL ORDER BY c.id',
        [org, session.user.id],
      );
      const matches = [];
      for (const c of cases) {
        const w = await workspaceIn(db, org, c.id),
          hits = caseHits(w, query);
        if (hits.length) matches.push({ caseId: c.id, title: w.caseRecord.title, hits });
      }
      return { cases: matches };
    });
  }
  if (route === 'cases' && method === 'GET')
    return {
      cases: await transaction((db) =>
        listCases(db, org, session.user.id, event.url.searchParams.get('q') ?? ''),
      ),
    };
  if (route === 'cases' && method === 'POST') {
    const f = await jsonFields(event.request),
      record = makeCase(f);
    return transaction((db) =>
      idempotent(db, org, 'cases', event.request.headers.get('idempotency-key'), async () => {
        await checkQuota(db, org, 'cases', 1);
        await insertWorkspace(db, org, emptyWorkspace(record), session.user.id);
        return record;
      }),
    );
  }
  if (route === 'cases/import' && method === 'POST') {
    const { importArchive } = await import('./archive');
    return importArchive(org, await event.request.formData(), session.user.id);
  }
  if (path[0] === 'cases' && path.length >= 2) return caseRequest(event, session, path[1], path.slice(2));
  if (route === 'demo/reseed' && method === 'POST') {
    return transaction(async (db) => {
      await orgLock(db, org);
      const [o] = await db.query<{ demo_id: string }>('SELECT demo_id FROM organizations WHERE id=$1', [org]);
      const rows = await db.query(
        'UPDATE cases SET deleted_at=NULL, archived=0, version=version+1 WHERE org_id=$1 AND id=$2 RETURNING id',
        [org, o.demo_id],
      );
      if (!rows.length) missing();
      return { caseId: o.demo_id };
    });
  }
  missing();
}

export async function endpoint(event: CoreRequest) {
  try {
    const result = await handle(event);
    return result instanceof Response ? result : Response.json(result);
  } catch (error) {
    if (error instanceof ApiError)
      return Response.json(
        {
          error: {
            code: error.code,
            message: error.message,
            retryable: error.status === 503,
            ...error.details,
          },
        },
        { status: error.status },
      );
    console.error('Jude API request failed', error instanceof Error ? error.name : 'UnknownError');
    return Response.json(
      { error: { code: 'internal_error', message: 'The request could not be completed.', retryable: true } },
      { status: 500 },
    );
  }
}
