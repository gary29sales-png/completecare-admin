import { NextResponse } from 'next/server';
import { authorizeRequest } from '../../../../lib/auth';
import { errorResponse, authResponse, readJsonBody } from '../../../../lib/http';
import { getDraft, setDraft } from '../../../../lib/schema';
import { validatePendingMutation } from '../../../../lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req) {
  try {
    const authorization = authorizeRequest(req, { mutation: true });
    if (!authorization.ok) return authResponse(authorization);

    const input = validatePendingMutation(await readJsonBody(req));
    const draft = await getDraft();

    if (input.action === 'unignore') {
      draft.ignored_adgs = draft.ignored_adgs.filter((adg) => adg !== input.adg);
      await setDraft(draft);
      return NextResponse.json({ ok: true });
    }

    const pendingList = draft.pending[input.brand] || [];
    if (input.action === 'clear') {
      const removedAdgs = pendingList.map((vehicle) => vehicle.adg).filter(Boolean);
      draft.pending[input.brand] = [];
      draft.ignored_adgs = Array.from(new Set([...draft.ignored_adgs, ...removedAdgs]));
      await setDraft(draft);
      return NextResponse.json({ ok: true, removedCount: removedAdgs.length });
    }

    const index = pendingList.findIndex((vehicle) => vehicle.adg === input.adg);
    if (index === -1) {
      return NextResponse.json({ error: 'Vehicle not found in pending queue.' }, { status: 404 });
    }

    pendingList.splice(index, 1);
    draft.pending[input.brand] = pendingList;
    if (!draft.ignored_adgs.includes(input.adg)) draft.ignored_adgs.push(input.adg);
    await setDraft(draft);

    return NextResponse.json({ ok: true, remainingPending: pendingList.length });
  } catch (error) {
    return errorResponse(error);
  }
}
