import { NextResponse } from 'next/server';
import { getDraft, setDraft } from '../../../../lib/schema';
import { checkSession } from '../login/route';
export const dynamic = 'force-dynamic';
function formatFactory(months, km) {
  if (!months && !km) return 'No Warranty';
  const parts = [];
  if (months) parts.push(`${months} months`);
  if (km) parts.push(`${Number(km).toLocaleString()}km`);
  return parts.join(' / ');
}

// Body shape:
// {
//   brand, adg,
//   noClutch: boolean,
//   exclusionMode: 'inherit' | 'brand' | 'adg_override',
//   components: [{ component, months, km }]   // for 'brand' mode
//   overridePeriod: { months, km }             // for 'adg_override' mode
// }
export async function POST(req) {
  if (!checkSession(req)) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json();
  const { brand, adg, noClutch, exclusionMode, components, overridePeriod } = body;

  if (!brand || !adg) {
    return NextResponse.json({ error: 'brand and adg are required.' }, { status: 400 });
  }

  const draft = await getDraft();
  const pendingList = draft.pending[brand] || [];
  const idx = pendingList.findIndex((v) => v.adg === adg);
  if (idx === -1) {
    return NextResponse.json({ error: 'Vehicle not found in pending queue.' }, { status: 404 });
  }
  const vehicle = pendingList[idx];

  // 1. Brand-wide exclusion table (only when this is a new/unconfirmed brand,
  //    or the admin is deliberately rebuilding the brand's table).
  if (exclusionMode === 'brand') {
    if (!Array.isArray(components) || components.length === 0) {
      return NextResponse.json(
        { error: 'components is required when exclusionMode is "brand".' },
        { status: 400 }
      );
    }
    draft.exclusions[brand] = {
      status: 'confirmed',
      items: components.map((c) => ({
        component: c.component,
        factory: formatFactory(c.months, c.km),
      })),
    };
    if (!draft.confirmed_brands.includes(brand)) {
      draft.confirmed_brands.push(brand);
    }
    draft.oem_only_brands = (draft.oem_only_brands || []).filter((b) => b !== brand);
  }

  // 2. Per-ADG override of the brand's standard drop-off period.
  if (exclusionMode === 'adg_override') {
    if (!overridePeriod || (!overridePeriod.months && !overridePeriod.km)) {
      return NextResponse.json(
        { error: 'overridePeriod is required when exclusionMode is "adg_override".' },
        { status: 400 }
      );
    }
    const months = overridePeriod.months ? `${overridePeriod.months} years` : '';
    const km = overridePeriod.km ? `${Number(overridePeriod.km).toLocaleString()}km` : '';
    draft.adg_exclusion_overrides[adg] = [months, km].filter(Boolean).join(' / ');
  }

  // 3. No-clutch flag (DHT/CVT/automatic — suppresses the clutch exclusion row).
  if (noClutch && vehicle.desc) {
    if (!draft.no_clutch_vehicles.includes(vehicle.desc)) {
      draft.no_clutch_vehicles.push(vehicle.desc);
    }
  }

  // 4. Move the vehicle from pending into the live dataset for this brand.
  if (!draft.vehicles[brand]) draft.vehicles[brand] = [];
  draft.vehicles[brand].push({
    adg: vehicle.adg,
    cap: vehicle.cap,
    hybrid: vehicle.hybrid,
    desc: vehicle.desc,
    range: vehicle.range,
    model: vehicle.model,
    warranty: vehicle.warranty,
    warr_km: vehicle.warr_km,
    warr_time: vehicle.warr_time,
  });

  pendingList.splice(idx, 1);
  draft.pending[brand] = pendingList;

  await setDraft(draft);

  return NextResponse.json({ ok: true, remainingPending: pendingList.length });
}
