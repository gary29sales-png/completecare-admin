import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { getDraft, setDraft } from '../../../../lib/schema';
import { checkSession } from '../login/route';

export const dynamic = 'force-dynamic';

// Column names as they actually appear in the weekly CompleteCare_Include
// export (confirmed against a real file, 18 June 2026 sheet). A little
// alias slack is kept per field in case the naming shifts slightly week
// to week, but ADG_CODE / BRAND / DESC / RANGE / MODEL / WARRANTY /
// WARR_KM / WARR_TIME are the exact real headers.
const HEADER_ALIASES = {
  adg: ['adg_code', 'adg code', 'adg', 'adg no', 'adg number'],
  brand: ['brand', 'make'],
  range: ['range', 'model range', 'variant range'],
  model: ['model', 'derivative', 'model description'],
  desc: ['desc', 'description', 'full description', 'vehicle description'],
  cap: ['capacity', 'cc', 'engine capacity'],
  warranty: ['warranty', 'warranty details', 'warranty & service plan', 'warranty and service plan'],
  warr_km: ['warr_km', 'warranty km', 'warr km', 'warranty distance'],
  warr_time: ['warr_time', 'warranty months', 'warr time', 'warranty period'],
};

// Words in the description that indicate a hybrid/PHEV drivetrain. The
// sheet has no dedicated hybrid column (FUEL_TYPE is only ever UNLEADED
// or DIESEL), so this is the best available signal — same approach the
// existing dataset already uses loosely.
const HYBRID_KEYWORDS = ['HEV', 'HYBRID', 'PHEV', 'DM-I', 'DHT'];

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
  // Fallback parse only used if warr_km/warr_time columns aren't present —
  // the real sheet has them as their own numeric columns, so this rarely runs.
  if (!warrantyText) return { warr_km: '', warr_time: '' };
  const m = warrantyText.match(/(\d+)\s*YEAR\/(\d[\d,]*)\s*KM/i);
  if (!m) return { warr_km: '', warr_time: '' };
  return {
    warr_time: String(parseInt(m[1], 10) * 12),
    warr_km: m[2].replace(/,/g, ''),
  };
}

// ADG codes come through as plain numbers in Excel, so leading zeros
// (e.g. BAIC's "05617150") are lost — they read back as 5617150. The
// existing dataset predominantly uses 8-digit zero-padded codes, so pad
// anything shorter back out to 8 digits. This is a best-effort fix, not
// guaranteed for every brand's convention — a few ADGs in the existing
// data (some BYD codes) are legitimately 7 digits, unpadded. Those will
// get zero-padded here too; if that ever creates a mismatch on a repeat
// upload, it'll show up as a "new" vehicle that's actually a duplicate,
// and it's easy to spot in the pending queue by description.
function normalizeAdg(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  let str;
  if (typeof raw === 'number') {
    str = String(Math.round(raw));
  } else {
    str = String(raw).trim();
    // Excel sometimes hands back "5617150.0" as text too.
    if (/^\d+\.0+$/.test(str)) str = str.split('.')[0];
  }
  if (/^\d+$/.test(str) && str.length < 8) {
    str = str.padStart(8, '0');
  }
  return str;
}

function detectHybrid(desc) {
  const upper = (desc || '').toUpperCase();
  return HYBRID_KEYWORDS.some((kw) => upper.includes(kw)) ? 'YES' : 'NO';
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
      if (v.adg) existingAdgs.add(normalizeAdg(v.adg));
    }
  }
  // Also exclude ADGs already sitting in the pending queue awaiting
  // categorization — otherwise re-uploading the same weekly sheet (or
  // uploading before last week's pending items are cleared) duplicates them.
  for (const brand of Object.keys(draft.pending || {})) {
    for (const v of draft.pending[brand]) {
      if (v.adg) existingAdgs.add(normalizeAdg(v.adg));
    }
  }

  const newlyFound = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const adg = colMap.adg !== undefined ? normalizeAdg(row[colMap.adg]) : '';
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
      hybrid: detectHybrid(desc),
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