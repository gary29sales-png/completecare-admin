const crypto = require('node:crypto');
const { ConfigurationError } = require('./errors');
const {
  getAdminOrigin,
  getBoundedInteger,
  getClientIp,
  getRequestOrigin,
  isProduction,
  normalizeOrigin,
} = require('./config');

const SESSION_COOKIE = 'cc_admin_session';
const CSRF_COOKIE = 'cc_admin_csrf';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;
const loginAttempts = new Map();

function getAuthConfig() {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (typeof password !== 'string' || password.length === 0) {
    throw new ConfigurationError('ADMIN_PASSWORD is not configured on the server.');
  }
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new ConfigurationError('ADMIN_SESSION_SECRET is not configured on the server.');
  }

  return { password, secret };
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function createSessionToken(secret, now = Date.now()) {
  const issuedAt = Math.floor(now / 1000);
  const payload = encode(JSON.stringify({
    sub: 'admin',
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS,
    jti: crypto.randomBytes(24).toString('hex'),
  }));
  return `${payload}.${sign(payload, secret)}`;
}

function verifySessionToken(token, secret, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    return false;
  }
  if (!safeEqual(sign(parts[0], secret), parts[1])) return false;

  let payload;
  try {
    payload = JSON.parse(decode(parts[0]));
  } catch {
    return false;
  }

  const nowSeconds = Math.floor(now / 1000);
  return payload
    && payload.sub === 'admin'
    && typeof payload.iat === 'number'
    && Number.isSafeInteger(payload.iat)
    && typeof payload.exp === 'number'
    && Number.isSafeInteger(payload.exp)
    && typeof payload.jti === 'string'
    && /^[a-f0-9]{48}$/.test(payload.jti)
    && payload.iat <= nowSeconds + 60
    && payload.exp > nowSeconds
    && payload.exp <= payload.iat + SESSION_MAX_AGE_SECONDS + 60;
}

function getCookie(req, name) {
  return req.cookies.get(name)?.value || '';
}

function hasValidSession(req) {
  const { secret } = getAuthConfig();
  return verifySessionToken(getCookie(req, SESSION_COOKIE), secret);
}

function checkSession(req) {
  try {
    return hasValidSession(req);
  } catch {
    return false;
  }
}

function originMatchesAdmin(req, candidate) {
  if (!candidate || candidate === 'null') return false;
  let origin;
  try {
    origin = normalizeOrigin(candidate, 'Origin');
  } catch {
    return false;
  }

  const configured = getAdminOrigin();
  return origin === (configured || getRequestOrigin(req));
}

function validateAdminOrigin(req, { allowCsrfFallback = true } = {}) {
  const origin = req.headers.get('origin');
  if (origin) return originMatchesAdmin(req, origin);

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return originMatchesAdmin(req, new URL(referer).origin);
    } catch {
      return false;
    }
  }

  if (!isProduction()) return true;
  return allowCsrfFallback && csrfMatches(req);
}

function validateLoginOrigin(req) {
  const origin = req.headers.get('origin');
  if (origin) return originMatchesAdmin(req, origin);

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return originMatchesAdmin(req, new URL(referer).origin);
    } catch {
      return false;
    }
  }

  return !isProduction();
}

function csrfMatches(req) {
  const cookieToken = getCookie(req, CSRF_COOKIE);
  const headerToken = req.headers.get('x-csrf-token') || '';
  return cookieToken.length > 0 && safeEqual(cookieToken, headerToken);
}

function authorizeRequest(req, { mutation = false } = {}) {
  if (!hasValidSession(req)) {
    return { ok: false, status: 401, error: 'Not authenticated.' };
  }
  if (mutation && !validateAdminOrigin(req)) {
    return { ok: false, status: 403, error: 'Origin or CSRF validation failed.' };
  }
  return { ok: true };
}

function cookieOptions(httpOnly) {
  return {
    httpOnly,
    sameSite: 'lax',
    secure: isProduction(),
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  };
}

function setSessionCookies(response, secret) {
  response.cookies.set(SESSION_COOKIE, createSessionToken(secret), cookieOptions(true));
  response.cookies.set(
    CSRF_COOKIE,
    crypto.randomBytes(32).toString('base64url'),
    cookieOptions(false)
  );
}

function clearSessionCookies(response) {
  response.cookies.set(SESSION_COOKIE, '', { ...cookieOptions(true), maxAge: 0 });
  response.cookies.set(CSRF_COOKIE, '', { ...cookieOptions(false), maxAge: 0 });
}

function loginRateLimitConfig() {
  return {
    maxAttempts: getBoundedInteger('LOGIN_RATE_LIMIT_MAX_ATTEMPTS', 5, 1, 100),
    windowMs: getBoundedInteger('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 15 * 60, 10, 24 * 60 * 60) * 1000,
  };
}

function pruneLoginAttempts(now, windowMs) {
  for (const [ip, entry] of loginAttempts) {
    if (entry.windowStartedAt + windowMs <= now && entry.blockedUntil <= now) {
      loginAttempts.delete(ip);
    }
  }

  if (loginAttempts.size <= 10000) return;
  const oldest = Array.from(loginAttempts.entries())
    .sort((left, right) => left[1].windowStartedAt - right[1].windowStartedAt)
    .slice(0, loginAttempts.size - 10000);
  for (const [ip] of oldest) loginAttempts.delete(ip);
}

function checkLoginRateLimit(req, now = Date.now()) {
  const { maxAttempts, windowMs } = loginRateLimitConfig();
  pruneLoginAttempts(now, windowMs);
  const ip = getClientIp(req);
  const entry = loginAttempts.get(ip);
  if (!entry || entry.blockedUntil <= now) {
    return { allowed: true, ip, maxAttempts, windowMs };
  }
  return {
    allowed: entry.failures < maxAttempts,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
    ip,
    maxAttempts,
    windowMs,
  };
}

function recordFailedLogin(ip, maxAttempts, windowMs, now = Date.now()) {
  const previous = loginAttempts.get(ip);
  const entry = previous && previous.windowStartedAt + windowMs > now
    ? previous
    : { failures: 0, windowStartedAt: now, blockedUntil: 0 };
  entry.failures += 1;
  if (entry.failures >= maxAttempts) {
    entry.blockedUntil = now + windowMs;
  }
  loginAttempts.set(ip, entry);
}

function clearFailedLogins(ip) {
  loginAttempts.delete(ip);
}

module.exports = {
  SESSION_COOKIE,
  CSRF_COOKIE,
  getAuthConfig,
  safeEqual,
  createSessionToken,
  verifySessionToken,
  checkSession,
  authorizeRequest,
  validateLoginOrigin,
  csrfMatches,
  setSessionCookies,
  clearSessionCookies,
  checkLoginRateLimit,
  recordFailedLogin,
  clearFailedLogins,
};
