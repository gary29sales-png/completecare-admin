import { NextResponse } from 'next/server';
import { errorResponse } from '../../lib/http';
import { checkReadiness } from '../../lib/health';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json(await checkReadiness());
  } catch (error) {
    return errorResponse(error);
  }
}
