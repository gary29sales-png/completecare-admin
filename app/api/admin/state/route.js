import { NextResponse } from 'next/server';
import { getDraft } from '../../../../lib/schema';
import { COMPONENT_CATEGORIES } from '../../../../lib/schema';
import { checkSession } from '../login/route';
export const dynamic = 'force-dynamic';
export async function GET(req) {
  if (!checkSession(req)) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }
  const draft = await getDraft();
  return NextResponse.json({ ...draft, componentCategories: COMPONENT_CATEGORIES });
}
