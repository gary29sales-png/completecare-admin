const { NextResponse } = require('next/server');
const { getPublicAllowedOrigins, isProduction, normalizeOrigin } = require('./config');

function getOriginHeader(req) {
  return req.headers.get('origin') || '';
}

function isAllowedOrigin(origin, allowedOrigins) {
  if (!origin) return false;
  if (allowedOrigins.includes('*') && !isProduction()) return true;
  try {
    return allowedOrigins.includes(normalizeOrigin(origin, 'Origin'));
  } catch {
    return false;
  }
}

function corsHeaders(req) {
  const allowedOrigins = getPublicAllowedOrigins();
  const origin = getOriginHeader(req);
  const headers = { Vary: 'Origin' };

  if (origin && isAllowedOrigin(origin, allowedOrigins)) {
    headers['Access-Control-Allow-Origin'] = allowedOrigins.includes('*') ? '*' : normalizeOrigin(origin, 'Origin');
  }
  return headers;
}

function preflightResponse(req) {
  const allowedOrigins = getPublicAllowedOrigins();
  const origin = getOriginHeader(req);
  const headers = corsHeaders(req);

  if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
    return NextResponse.json({ error: 'Origin is not allowed.' }, { status: 403, headers });
  }

  headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type, If-None-Match';
  headers['Access-Control-Max-Age'] = '600';
  return new NextResponse(null, { status: 204, headers });
}

module.exports = {
  corsHeaders,
  preflightResponse,
  isAllowedOrigin,
};
