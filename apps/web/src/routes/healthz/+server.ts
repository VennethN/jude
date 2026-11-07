import { transaction } from '@jude/core/server/db';

export async function GET() {
  try {
    await transaction((db) => db.query('SELECT 1'));
    return new Response('ok', { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return new Response('unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
