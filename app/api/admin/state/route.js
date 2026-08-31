import { NextResponse } from 'next/server';
import { authorizeRequest } from '../../../../lib/auth';
import { errorResponse, authResponse } from '../../../../lib/http';
import { COMPONENT_CATEGORIES, getDraft } from '../../../../lib/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req) {
  try {
    const authorization = authorizeRequest(req);
    if (!authorization.ok) return authResponse(authorization);

    const draft = await getDraft();
    return NextResponse.json({ ...draft, componentCategories: COMPONENT_CATEGORIES });
  } catch (error) {
    return errorResponse(error);
  }
}
