import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDraft, setDraft } from '../../../../lib/schema';
import { checkSession } from '../login/route';
export const dynamic = 'force-dynamic';
// Loose header matching so small variations in the weekly Excel export
// ("ADG", "ADG Code", "ADG No") don't break parsing. Gary: adjust these
// alias lists once we see a real file if the column names differ.
const HEADER_ALIASES = {
  adg: ['adg', 'adg code', 'adg no', 'adg number'],
  brand: ['brand', 'make'],
  range: ['range', 'model range', 'variant range'],
  model: ['model', 'derivative', 'model description'],
  desc: ['description', 'full description', 'vehicle description'],
  cap: ['capacity', 'cc', 'engine capacity'],
  hybrid: ['hybrid'],
  warranty: ['warranty', 'warranty details', 'warranty & service plan', 'warranty and service plan'],
  warr_km: ['warranty km', 'warr km', 'warranty distance'],
  warr_time: ['warranty months', 'warr time', 'warranty period'],
};

function normalizeHeader(h) {
  return String(h || '').trim().toLowerCase();
}

function buildColumnMap(headerRow) {
  const map = {};
  const normalized = headerRow.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) map[field] = idx;
  }
  return map;
}

function extractWarrantyKmTime(warrantyText) {
  // Fallback parse: pull the first "N YEAR/MKM WARRANTY" style figure out
  // of the free-text warranty string if warr_km/warr_time weren't
  // supplied as their own columns.
  if (!warrantyText) return { warr_km: '', warr_time: '' };
  const m = warrantyText.match(/(\d+)\s*YEAR\/(\d[\d,]*)\s*KM/i);
  if (!m) return { warr_km: '', warr_time: '' };
  return {
    warr_time: String(parseInt(m[1], 10) * 12),
    warr_km: m[2].replace(/,/g, ''),
  };
}

export async function POST(req) {
  if (!checkSession(req)) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!file) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  if (rows.length < 2) {
    return NextResponse.json({ error: 'Sheet appears to be empty.' }, { status: 400 });
  }

  const colMap = buildColumnMap(rows[0]);
  if (colMap.adg === undefined) {
    return NextResponse.json(
      { error: 'Could not find an ADG column in the sheet. Check the header row.' },
      { status: 400 }
    );
  }

  const draft = await getDraft();
  const existingAdgs = new Set();
  for (const brand of Object.keys(draft.vehicles)) {
    for (const v of draft.vehicles[brand]) {
      if (v.adg) existingAdgs.add(String(v.adg).trim());
    }
  }
  // Also exclude ADGs already sitting in the pending queue awaiting
  // categorization — otherwise re-uploading the same weekly sheet (or
  // uploading before last week's pending items are cleared) duplicates them.
  for (const brand of Object.keys(draft.pending || {})) {
    for (const v of draft.pending[brand]) {
      if (v.adg) existingAdgs.add(String(v.adg).trim());
    }
  }

  const newlyFound = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const adg = colMap.adg !== undefined ? String(row[colMap.adg] || '').trim() : '';
    if (!adg || existingAdgs.has(adg)) continue;

    const desc = colMap.desc !== undefined ? String(row[colMap.desc] || '').trim() : '';
    const brand =
      (colMap.brand !== undefined && String(row[colMap.brand] || '').trim()) ||
      (desc.split(' ')[0] || 'UNKNOWN').toUpperCase();
    const warranty = colMap.warranty !== undefined ? String(row[colMap.warranty] || '').trim() : '';
    const parsedWarranty = extractWarrantyKmTime(warranty);

    const vehicle = {
      adg,
      cap: colMap.cap !== undefined ? String(row[colMap.cap] || '').trim() : '',
      hybrid: colMap.hybrid !== undefined ? String(row[colMap.hybrid] || 'NO').trim().toUpperCase() : 'NO',
      desc,
      range: colMap.range !== undefined ? String(row[colMap.range] || '').trim() : '',
      model: colMap.model !== undefined ? String(row[colMap.model] || '').trim() : '',
      warranty,
      warr_km: colMap.warr_km !== undefined ? String(row[colMap.warr_km] || '').trim() : parsedWarranty.warr_km,
      warr_time: colMap.warr_time !== undefined ? String(row[colMap.warr_time] || '').trim() : parsedWarranty.warr_time,
    };

    if (!draft.pending[brand]) draft.pending[brand] = [];
    draft.pending[brand].push(vehicle);
    existingAdgs.add(adg); // avoid double-adding duplicate rows within the same sheet
    newlyFound.push({ brand, ...vehicle });
  }

  await setDraft(draft);

  return NextResponse.json({
    ok: true,
    newCount: newlyFound.length,
    newVehicles: newlyFound,
  });
}
