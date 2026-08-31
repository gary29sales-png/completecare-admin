const { NextResponse } = require('next/server');
const {
  AppError,
  ConfigurationError,
  PayloadTooLargeError,
  ValidationError,
} = require('./errors');

const DEFAULT_JSON_LIMIT = 32 * 1024;

function getContentLength(req) {
  const raw = req.headers.get('content-length');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) {
    throw new ValidationError('Content-Length must be a valid non-negative integer.');
  }
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) {
    throw new PayloadTooLargeError();
  }
  return length;
}

async function readJsonBody(req, maxBytes = DEFAULT_JSON_LIMIT) {
  const contentType = req.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ValidationError('Content-Type must be application/json.', 415);
  }

  const contentLength = getContentLength(req);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new PayloadTooLargeError();
  }

  let body;
  try {
    body = await req.json();
  } catch {
    throw new ValidationError('Invalid JSON request body.');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('JSON request body must be an object.');
  }
  return body;
}

function applyHeaders(response, headers = {}) {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) response.headers.set(name, String(value));
  }
  return response;
}

function errorResponse(error, headers = {}) {
  if (!(error instanceof AppError) || error.status >= 500) {
    console.error('Unhandled API error:', error);
  }

  const knownError = error instanceof AppError;
  const status = knownError ? error.status : 500;
  const message = knownError && error.expose && status < 500
    ? error.message
    : status === 503
      ? 'Service unavailable.'
      : 'Internal server error.';
  const response = NextResponse.json({ error: message }, { status });
  return applyHeaders(response, headers);
}

function authResponse(result) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

module.exports = {
  DEFAULT_JSON_LIMIT,
  getContentLength,
  readJsonBody,
  applyHeaders,
  errorResponse,
  authResponse,
};
