import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
// Single shared password stored in an env var (ADMIN_PASSWORD on Vercel).
// Not a full auth system — matches the scale of the existing tools
// (Gary is the only admin user).
export async function POST(req) {
  const { password } = await req.json();
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return NextResponse.json(
      { error: 'ADMIN_PASSWORD is not configured on the server.' },
      { status: 500 }
    );
  }

  if (password !== expected) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set('cc_admin_session', expected, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return res;
}

export function checkSession(req) {
  const session = req.cookies.get('cc_admin_session')?.value;
  return !!session && session === process.env.ADMIN_PASSWORD;
}
