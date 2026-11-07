import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import type { Preferences, SessionInfo } from '../domain';
import { transaction, type Database } from './db';
import { seedOrganization } from './cases';
import {
  ApiError,
  bool,
  choice,
  email,
  invalid,
  missing,
  number,
  string,
  unavailable,
  type Fields,
} from './validation';

const sessionDays = 30;
const cookieName = 'jude_session';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const day = 86_400_000;

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  guest: number;
  prefs: string;
  org_id: string;
  organization: string;
  role: SessionInfo['role'];
  plan_id: SessionInfo['plan']['id'];
  demo_id: string | null;
  demo_refs: string;
}
function projectSession(row: UserRow): SessionInfo {
  return {
    user: { id: row.id, name: row.name, email: row.email ?? '', guest: Boolean(row.guest) },
    organization: { id: row.org_id, name: row.organization },
    role: row.role,
    plan: { id: row.plan_id },
    prefs: JSON.parse(row.prefs),
    demo: row.demo_id ? { caseId: row.demo_id, refs: JSON.parse(row.demo_refs) } : null,
  };
}
const profile =
  'SELECT u.id,u.name,u.email,u.guest,u.prefs,m.org_id,m.role,o.name AS organization,' +
  "CASE WHEN o.plan_status='trialing' AND o.trial_ends<=$2 THEN 'basic' ELSE o.plan_id END AS plan_id," +
  'cm.case_id AS demo_id,o.demo_refs FROM users u JOIN memberships m ON m.user_id=u.id JOIN organizations o ON m.org_id=o.id LEFT JOIN cases c ON c.id=o.demo_id AND c.deleted_at IS NULL LEFT JOIN case_members cm ON cm.case_id=c.id AND cm.user_id=u.id';
async function byUser(db: Database, userId: string) {
  const [row] = await db.query<UserRow>(profile + ' WHERE u.id=$1', [userId, Date.now()]);
  if (!row) missing();
  return projectSession(row);
}
export async function sessionFromToken(token: string | undefined) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  return transaction(async (db) => {
    const [row] = await db.query<UserRow>(
      profile + ' JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>$2',
      [hash(token), Date.now()],
    );
    return row ? projectSession(row) : null;
  });
}
export function requireSession(event: RequestEvent) {
  if (!event.locals.session) throw new ApiError(401, 'unauthenticated', 'Sign in to access this workspace.');
  return event.locals.session;
}
function password(value: unknown, newPassword: boolean) {
  if (typeof value !== 'string' || !value.length || value.length > 256 || (newPassword && value.length < 8))
    invalid('password');
  return value;
}
function key(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 }, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  );
}
function passwordHash(value: string) {
  return argonHash(value, { algorithm: 2, memoryCost: 19456, timeCost: 3, parallelism: 1 });
}
let dummyHash: Promise<string> | undefined;
async function verifies(value: string, encoded: string | undefined) {
  if (!encoded || encoded.startsWith('$argon2id$')) {
    const reference = encoded ?? (await (dummyHash ??= passwordHash(randomBytes(24).toString('hex'))));
    return (await argonVerify(reference, value)) && Boolean(encoded);
  }
  // Accounts created with the earlier scrypt hash upgrade after their next successful sign-in.
  if (!/^[a-f0-9]{48}:[a-f0-9]{128}$/.test(encoded)) return false;
  const [salt, expected] = encoded.split(':');
  return timingSafeEqual(await key(value, salt), Buffer.from(expected, 'hex'));
}
export async function rateLimit(db: Database, scope: string, subject: string, limit: number, span: number) {
  const now = Date.now(),
    rateKey = hash(scope + '|' + subject);
  const [row] = await db.query<{ count: number }>(
    'INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=$3 THEN 1 ELSE rate_limits.count+1 END,reset_at=CASE WHEN rate_limits.reset_at<=$3 THEN excluded.reset_at ELSE rate_limits.reset_at END RETURNING count',
    [rateKey, now + span, now],
  );
  if (row.count > limit) throw new ApiError(429, 'rate_limited', 'Try again later.');
}
export function clientId(event: RequestEvent) {
  try {
    return event.getClientAddress();
  } catch {
    return 'local';
  }
}

async function makeSession(db: Database, userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.query('DELETE FROM sessions WHERE user_id=$1 AND expires_at<=$2', [userId, Date.now()]);
  await db.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [
    hash(token),
    userId,
    Date.now() + day * sessionDays,
  ]);
  return { token, session: await byUser(db, userId) };
}
function attach(event: RequestEvent, result: { token: string; session: SessionInfo }) {
  event.cookies.set(cookieName, result.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: event.url.protocol === 'https:',
    maxAge: sessionDays * 86400,
  });
  event.locals.session = result.session;
  return result.session;
}
async function createOrganization(
  db: Database,
  details: {
    name: string;
    email: string | null;
    encoded: string | null;
    lang: 'id' | 'en';
    plan: 'basic' | 'pro' | 'firm';
    cycle: 'monthly' | 'yearly';
    guest: boolean;
  },
) {
  const orgId = randomUUID(),
    userId = randomUUID(),
    now = Date.now(),
    trial = !details.guest && details.plan !== 'basic';
  await db.query(
    'INSERT INTO organizations(id,name,plan_id,cycle,plan_status,trial_ends,trial_used,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      orgId,
      details.name,
      details.plan,
      details.cycle,
      trial ? 'trialing' : 'active',
      trial ? now + 14 * day : null,
      Number(trial),
      now,
    ],
  );
  const result = await db.query<{ id: string }>(
    'INSERT INTO users(id,email,name,password_hash,guest,prefs,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(email) DO NOTHING RETURNING id',
    [
      userId,
      details.email,
      details.name,
      details.encoded,
      Number(details.guest),
      JSON.stringify({ lang: details.lang }),
      now,
    ],
  );
  if (!result.length) throw new ApiError(409, 'email_in_use', 'This email is already registered.');
  await db.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [orgId, userId]);
  await seedOrganization(db, orgId);
  return makeSession(db, userId);
}
export async function beginDemo(event: RequestEvent) {
  if (event.locals.session) return event.locals.session;
  return attach(
    event,
    await transaction(async (db) => {
      await rateLimit(db, 'demo', clientId(event), 40, 60 * 60 * 1000);
      return createOrganization(db, {
        name: 'Ruang contoh',
        email: null,
        encoded: null,
        guest: true,
        plan: 'pro',
        cycle: 'monthly',
        lang: event.cookies.get('jude_lang') === 'en' ? 'en' : 'id',
      });
    }),
  );
}
export async function signup(event: RequestEvent, fields: Fields) {
  const name = string(fields.name, 'name', 100),
    address = email(fields.email),
    secret = password(fields.password, true);
  const lang = choice(fields.lang ?? 'id', ['id', 'en'], 'lang');
  const plan = choice(fields.planId ?? 'basic', ['basic', 'pro', 'firm'], 'planId'),
    cycle = choice(fields.cycle ?? 'monthly', ['monthly', 'yearly'], 'cycle');
  await transaction((db) => rateLimit(db, 'signup', clientId(event), 20, 60 * 60 * 1000));
  const encoded = await passwordHash(secret);
  return attach(
    event,
    await transaction((db) =>
      createOrganization(db, { name, email: address, encoded, lang, guest: false, plan, cycle }),
    ),
  );
}
export async function login(event: RequestEvent, fields: Fields) {
  const address = email(fields.email),
    secret = password(fields.password, false);
  const user = await transaction(async (db) => {
    await rateLimit(db, 'login', clientId(event), 45, 15 * 60 * 1000);
    await rateLimit(db, 'login-account', address, 20, 15 * 60 * 1000);
    const [row] = await db.query<{ id: string; password_hash: string }>(
      'SELECT id,password_hash FROM users WHERE email=$1 AND guest=0',
      [address],
    );
    return row;
  });
  if (!(await verifies(secret, user?.password_hash)))
    throw new ApiError(401, 'invalid_credentials', 'Check your email and password.');
  const migrated = user.password_hash.startsWith('$argon2id$') ? undefined : await passwordHash(secret);
  return attach(
    event,
    await transaction(async (db) => {
      if (migrated)
        await db.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND password_hash=$3', [
          migrated,
          user.id,
          user.password_hash,
        ]);
      return makeSession(db, user.id);
    }),
  );
}
export async function logout(event: RequestEvent) {
  const token = event.cookies.get(cookieName);
  if (token) await transaction((db) => db.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]));
  event.cookies.delete(cookieName, { path: '/' });
  event.locals.session = null;
  return { ok: true };
}
export function preferences(input: Fields): Preferences {
  const prefs: Preferences = {};
  if ('lang' in input) prefs.lang = choice(input.lang, ['id', 'en'], 'lang');
  if ('theme' in input) prefs.theme = choice(input.theme, ['paper', 'night', 'system'], 'theme');
  if ('density' in input) prefs.density = choice(input.density, ['comfortable', 'compact'], 'density');
  if ('assistantMode' in input)
    prefs.assistantMode = choice(input.assistantMode, ['docked', 'overlay'], 'assistantMode');
  if ('findingScope' in input)
    prefs.findingScope = choice(input.findingScope, ['meaningful', 'all'], 'findingScope');
  if ('railCollapsed' in input) prefs.railCollapsed = bool(input.railCollapsed, 'railCollapsed');
  if ('tourSeen' in input) prefs.tourSeen = bool(input.tourSeen, 'tourSeen');
  if ('liveTextSize' in input) prefs.liveTextSize = number(input.liveTextSize, 'liveTextSize', 0, 3);
  if ('toursDone' in input) {
    if (!Array.isArray(input.toursDone) || input.toursDone.length > 20) invalid('toursDone');
    prefs.toursDone = [...new Set(input.toursDone.map((v) => string(v, 'toursDone', 40)))];
  }
  return prefs;
}
export async function setPrefs(event: RequestEvent, input: Fields) {
  const session = requireSession(event),
    patch = preferences(input);
  const prefs = await transaction(async (db) => {
    const [row] = await db.query<{ prefs: string }>('SELECT prefs FROM users WHERE id=$1' + db.forUpdate, [
      session.user.id,
    ]);
    const result = { ...JSON.parse(row.prefs), ...patch } as Preferences;
    await db.query('UPDATE users SET prefs=$1 WHERE id=$2', [JSON.stringify(result), session.user.id]);
    return result;
  });
  if (patch.lang)
    event.cookies.set('jude_lang', patch.lang, {
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: event.url.protocol === 'https:',
      maxAge: 365 * 86400,
    });
  return prefs;
}

function mailConfig() {
  const from = process.env.JUDE_MAIL_FROM,
    origin = process.env.ORIGIN,
    region = process.env.AWS_REGION;
  if (!from || !origin || !region) unavailable('email');
  return { from, origin, region };
}
async function sendLink(to: string, token: string, purpose: 'reset' | 'invite') {
  const { from, origin, region } = mailConfig();
  const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
  const path = purpose === 'reset' ? '/reset?token=' + token : '/invite/' + token;
  try {
    await new SESv2Client({ region }).send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: {
              Data: purpose === 'reset' ? 'Atur ulang kata sandi Jude' : 'Undangan ruang perkara Jude',
            },
            Body: { Text: { Data: new URL(path, origin).toString() } },
          },
        },
      }),
    );
  } catch {
    unavailable('email');
  }
}
export async function resetRequest(event: RequestEvent, fields: Fields) {
  const address = email(fields.email);
  mailConfig();
  const token = randomBytes(32).toString('hex');
  const known = await transaction(async (db) => {
    await rateLimit(db, 'reset-ip', clientId(event), 12, 60 * 60 * 1000);
    await rateLimit(db, 'reset-email', address, 4, 60 * 60 * 1000);
    const [user] = await db.query<{ id: string }>('SELECT id FROM users WHERE email=$1 AND guest=0', [
      address,
    ]);
    if (!user) return false;
    await db.query(
      "INSERT INTO auth_tokens(token_hash,purpose,subject,email,expires_at) VALUES($1,'reset',$2,$3,$4)",
      [hash(token), user.id, address, Date.now() + 60 * 60 * 1000],
    );
    return true;
  });
  if (known) await sendLink(address, token, 'reset');
  return { ok: true };
}
export async function resetConfirm(fields: Fields) {
  const token = string(fields.token, 'token', 100),
    encoded = await passwordHash(password(fields.password, true));
  return transaction(async (db) => {
    const [user] = await db.query<{ subject: string }>(
      "DELETE FROM auth_tokens WHERE token_hash=$1 AND purpose='reset' AND expires_at>$2 RETURNING subject",
      [hash(token), Date.now()],
    );
    if (!user) throw new ApiError(400, 'invalid_token', 'The reset link has expired.');
    await db.query('UPDATE users SET password_hash=$1 WHERE id=$2', [encoded, user.subject]);
    await db.query("DELETE FROM auth_tokens WHERE purpose='reset' AND subject=$1", [user.subject]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [user.subject]);
    return { ok: true };
  });
}
export async function invite(event: RequestEvent, fields: Fields) {
  const session = requireSession(event);
  if (session.role === 'member' || session.user.guest)
    throw new ApiError(403, 'forbidden', 'An account administrator can invite members.');
  mailConfig();
  const address = email(fields.email),
    role = choice(fields.role ?? 'member', ['admin', 'member'], 'role'),
    token = randomBytes(32).toString('hex');
  const { checkQuota } = await import('./billing');
  await transaction(async (db) => {
    await checkQuota(db, session.organization.id, 'seats', 1);
    await db.query(
      "INSERT INTO auth_tokens(token_hash,purpose,subject,email,role,expires_at) VALUES($1,'invite',$2,$3,$4,$5)",
      [hash(token), session.organization.id, address, role, Date.now() + 7 * day],
    );
  });
  await sendLink(address, token, 'invite');
  return { ok: true };
}
export async function acceptInvite(event: RequestEvent, fields: Fields) {
  const token = string(fields.token, 'token', 100),
    name = string(fields.name, 'name', 100);
  const encoded = await passwordHash(password(fields.password, true));
  const { checkQuota } = await import('./billing');
  const result = await transaction(async (db) => {
    const [ticket] = await db.query<{ subject: string; email: string; role: string }>(
      "DELETE FROM auth_tokens WHERE token_hash=$1 AND purpose='invite' AND expires_at>$2 RETURNING subject,email,role",
      [hash(token), Date.now()],
    );
    if (!ticket) throw new ApiError(400, 'invalid_token', 'The invitation has expired.');
    await checkQuota(db, ticket.subject, 'seats', 1);
    const userId = randomUUID();
    const newUser = await db.query(
      'INSERT INTO users(id,email,name,password_hash,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING id',
      [userId, ticket.email, name, encoded, Date.now()],
    );
    if (!newUser.length) throw new ApiError(409, 'email_in_use', 'This email is already registered.');
    await db.query('INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3)', [
      ticket.subject,
      userId,
      ticket.role,
    ]);
    await db.query(
      "INSERT INTO case_members(case_id,user_id,role) SELECT id,$1,'editor' FROM cases WHERE org_id=$2 AND synthetic=1 AND deleted_at IS NULL",
      [userId, ticket.subject],
    );
    return makeSession(db, userId);
  });
  return attach(event, result);
}
