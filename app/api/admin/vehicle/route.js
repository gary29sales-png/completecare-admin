import { NextResponse } from 'next/server';
import { authorizeRequest } from '../../../../lib/auth';
import { errorResponse, authResponse, readJsonBody } from '../../../../lib/http';
import { COMPONENT_CATEGORIES, getDraft, setDraft } from '../../../../lib/schema';
import { validateVehicleMutation } from '../../../../lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function formatFactory(months, km) {
  if (!months && !km) return 'No Warranty';
  const parts = [];
  if (months) parts.push(`${months} months`);
  if (km) parts.push(`${Number(km).toLocaleString()}km`);
  return parts.join(' / ');
}

function formatOverridePeriod(months, km) {
  const parts = [];
  if (months) parts.push(`${months} years`);
  if (km) parts.push(`${Number(km).toLocaleString()}km`);
  return parts.join(' / ');
}

export async function POST(req) {
  try {
    const authorization = authorizeRequest(req, { mutation: true });
    if (!authorization.ok) return authResponse(authorization);

    const body = await readJsonBody(req);
    const input = validateVehicleMutation(body, COMPONENT_CATEGORIES);
    const draft = await getDraft();
    const pendingList = draft.pending[input.brand] || [];
    const index = pendingList.findIndex((vehicle) => vehicle.adg === input.adg);
    if (index === -1) {
      return NextResponse.json({ error: 'Vehicle not found in pending queue.' }, { status: 404 });
    }
    const vehicle = pendingList[index];

    if (input.exclusionMode === 'brand') {
      draft.exclusions[input.brand] = {
        status: 'confirmed',
        items: input.components.map((component) => ({
          component: component.component,
          factory: formatFactory(component.months, component.km),
        })),
      };
      if (!draft.confirmed_brands.includes(input.brand)) {
        draft.confirmed_brands.push(input.brand);
      }
      draft.oem_only_brands = (draft.oem_only_brands || []).filter((entry) => (
        (typeof entry === 'string' ? entry : entry.name) !== input.brand
      ));
    }

    if (input.exclusionMode === 'adg_override') {
      draft.adg_exclusion_overrides[input.adg] = formatOverridePeriod(
        input.overridePeriod.months,
        input.overridePeriod.km
      );
    }

    if (input.noClutch && vehicle.desc && !draft.no_clutch_vehicles.includes(vehicle.desc)) {
      draft.no_clutch_vehicles.push(vehicle.desc);
    }

    if (!draft.vehicles[input.brand]) draft.vehicles[input.brand] = [];
    draft.vehicles[input.brand].push({
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

    pendingList.splice(index, 1);
    draft.pending[input.brand] = pendingList;
    await setDraft(draft);

    return NextResponse.json({ ok: true, remainingPending: pendingList.length });
  } catch (error) {
    return errorResponse(error);
  }
}
