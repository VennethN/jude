import { transaction } from '@jude/core/server/db';
export async function GET() {
  try {
    await transaction((db) => db.query('SELECT 1'));
    return new Response('ok', { headers: { 'cache-control': 'no-store' } });
  } catch {
    return new Response('unavailable', { status: 503 });
  }
}
