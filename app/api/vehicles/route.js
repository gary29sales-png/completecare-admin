import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { corsHeaders, preflightResponse } from '../../../lib/cors';
import { errorResponse, applyHeaders } from '../../../lib/http';
import { getPublished } from '../../../lib/schema';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function matchesEtag(header, etag) {
  if (!header) return false;
  const bareEtag = etag.replace(/^W\//, '');
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === '*' || value === etag || value.replace(/^W\//, '') === bareEtag;
  });
}

export async function OPTIONS(req) {
  try {
    return preflightResponse(req);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(req) {
  let headers;
  try {
    headers = corsHeaders(req);
    const published = await getPublished();
    const body = JSON.stringify(published);
    const etag = `"${crypto.createHash('sha256').update(body).digest('hex')}"`;
    headers.ETag = etag;
    headers['Cache-Control'] = 'public, max-age=60, stale-while-revalidate=300';
    headers['Content-Type'] = 'application/json; charset=utf-8';

    if (matchesEtag(req.headers.get('if-none-match'), etag)) {
      return new NextResponse(null, { status: 304, headers });
    }
    return applyHeaders(new NextResponse(body, { status: 200 }), headers);
  } catch (error) {
    return errorResponse(error, headers);
  }
}
