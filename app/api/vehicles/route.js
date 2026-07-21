import { NextResponse } from 'next/server';
import { getPublished } from '../../../lib/schema';

export const dynamic = 'force-dynamic';

// Public, read-only. The Traficc and Avis BM tools fetch this on load
// instead of embedding the vehicle data directly in the HTML.
export async function GET() {
  const data = await getPublished();
  return NextResponse.json(data, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
