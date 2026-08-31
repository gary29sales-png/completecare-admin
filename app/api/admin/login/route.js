import { NextResponse } from 'next/server';
import {
  clearFailedLogins,
  checkLoginRateLimit,
  getAuthConfig,
  recordFailedLogin,
  setSessionCookies,
  safeEqual,
  validateLoginOrigin,
} from '../../../../lib/auth';
import { assertAllowedKeys } from '../../../../lib/validation';
import { errorResponse, readJsonBody } from '../../../../lib/http';
import { ValidationError } from '../../../../lib/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const { password, secret } = getAuthConfig();
    if (!validateLoginOrigin(req)) {
      return NextResponse.json({ error: 'Origin validation failed.' }, { status: 403 });
    }

    const rateLimit = checkLoginRateLimit(req);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
      );
    }

    const body = await readJsonBody(req);
    assertAllowedKeys(body, ['password'], 'Request body');
    if (typeof body.password !== 'string' || body.password.length > 512) {
      throw new ValidationError('password must be a string of 512 characters or fewer.');
    }

    if (!safeEqual(body.password, password)) {
      recordFailedLogin(rateLimit.ip, rateLimit.maxAttempts, rateLimit.windowMs);
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    clearFailedLogins(rateLimit.ip);
    const response = NextResponse.json({ ok: true });
    setSessionCookies(response, secret);
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
