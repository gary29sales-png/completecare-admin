import { NextResponse } from 'next/server';
import { publishDraft } from '../../../../lib/schema';
import { checkSession } from '../login/route';
export const dynamic = 'force-dynamic';
export async function POST(req) {
  if (!checkSession(req)) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  const published = await publishDraft();
  return NextResponse.json({ ok: true, published });
}
