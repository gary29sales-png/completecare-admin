const { ConfigurationError } = require('./errors');

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function normalizeOrigin(value, variableName = 'origin') {
  const raw = String(value || '').trim();
  if (!raw) {
    throw new ConfigurationError(`${variableName} must not be empty.`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ConfigurationError(`${variableName} must be a valid http(s) origin.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== '' && parsed.pathname !== '/')) {
    throw new ConfigurationError(`${variableName} must contain only an http(s) origin.`);
  }

  return parsed.origin;
}

function parseOriginList(raw, variableName) {
  const values = String(raw || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (values.length === 0) return [];

  if (values.includes('*')) {
    if (isProduction()) {
      throw new ConfigurationError(`${variableName} must list exact origins; wildcard CORS is not allowed in production.`);
    }
    if (values.length > 1) {
      throw new ConfigurationError(`${variableName} cannot combine "*" with exact origins.`);
    }
    return ['*'];
  }

  return Array.from(new Set(values.map((value) => normalizeOrigin(value, variableName))));
}

function getPublicAllowedOrigins() {
  const configured = process.env.PUBLIC_ALLOWED_ORIGINS
    ?? process.env.CORS_ALLOWED_ORIGINS
    ?? process.env.ALLOWED_ORIGIN
    ?? '';
  return parseOriginList(configured, 'PUBLIC_ALLOWED_ORIGINS');
}

function getAdminOrigin() {
  const configured = process.env.ADMIN_ORIGIN ?? process.env.ADMIN_ALLOWED_ORIGIN ?? '';
  if (!configured.trim()) {
    if (isProduction()) {
      throw new ConfigurationError('ADMIN_ORIGIN is required in production for admin Origin/CSRF validation.');
    }
    return null;
  }
  return normalizeOrigin(configured, 'ADMIN_ORIGIN');
}

function getRequestOrigin(req) {
  try {
    const requestUrl = new URL(req.url);
    let protocol = requestUrl.protocol;
    if (process.env.TRUST_PROXY === 'true') {
      const forwardedProtocol = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      if (forwardedProtocol === 'http' || forwardedProtocol === 'https') {
        protocol = `${forwardedProtocol}:`;
      }
    }
    return `${protocol}//${requestUrl.host}`;
  } catch {
    return null;
  }
}

function getClientIp(req) {
  if (process.env.TRUST_PROXY === 'true') {
    const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded && forwarded.length <= 128) return forwarded;

    const realIp = req.headers.get('x-real-ip')?.trim();
    if (realIp && realIp.length <= 128) return realIp;
  }

  return 'unknown';
}

function getBoundedInteger(name, defaultValue, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

module.exports = {
  isProduction,
  normalizeOrigin,
  getPublicAllowedOrigins,
  getAdminOrigin,
  getRequestOrigin,
  getClientIp,
  getBoundedInteger,
};
