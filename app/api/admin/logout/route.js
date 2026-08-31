import { NextResponse } from 'next/server';
import { authorizeRequest, clearSessionCookies } from '../../../../lib/auth';
import { authResponse, errorResponse } from '../../../../lib/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const authorization = authorizeRequest(req, { mutation: true });
    if (!authorization.ok) return authResponse(authorization);

    const response = NextResponse.json({ ok: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
