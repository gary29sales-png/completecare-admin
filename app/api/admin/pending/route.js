import { NextResponse } from 'next/server';
import { getDraft, setDraft } from '../../../../lib/schema';
import { checkSession } from '../login/route';

export const dynamic = 'force-dynamic';

// Body shape:
// { brand, adg }              -> remove a single pending vehicle, ignore its ADG going forward
// { brand, clearAll: true }   -> discard everything pending for that brand, ignore all their ADGs
// { unignoreAdg: adg }        -> undo a discard — the ADG can surface again on next upload
export async function POST(req) {
  if (!checkSession(req)) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json();
  const { brand, adg, clearAll, unignoreAdg } = body;

  const draft = await getDraft();

  if (unignoreAdg) {
    draft.ignored_adgs = draft.ignored_adgs.filter((a) => a !== unignoreAdg);
    await setDraft(draft);
    return NextResponse.json({ ok: true });
  }

  if (!brand) {
    return NextResponse.json({ error: 'brand is required.' }, { status: 400 });
  }

  const pendingList = draft.pending[brand] || [];

  if (clearAll) {
    const removedAdgs = pendingList.map((v) => v.adg).filter(Boolean);
    draft.pending[brand] = [];
    draft.ignored_adgs = Array.from(new Set([...draft.ignored_adgs, ...removedAdgs]));
    await setDraft(draft);
    return NextResponse.json({ ok: true, removedCount: removedAdgs.length });
  }

  if (!adg) {
    return NextResponse.json(
      { error: 'adg is required unless clearAll is set.' },
      { status: 400 }
    );
  }

  const idx = pendingList.findIndex((v) => v.adg === adg);
  if (idx === -1) {
    return NextResponse.json({ error: 'Vehicle not found in pending queue.' }, { status: 404 });
  }

  pendingList.splice(idx, 1);
  draft.pending[brand] = pendingList;
  if (!draft.ignored_adgs.includes(adg)) draft.ignored_adgs.push(adg);
  await setDraft(draft);

  return NextResponse.json({ ok: true, remainingPending: pendingList.length });
}