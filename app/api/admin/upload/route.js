import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { authorizeRequest } from '../../../../lib/auth';
import { getBoundedInteger } from '../../../../lib/config';
import { errorResponse, authResponse, getContentLength } from '../../../../lib/http';
import { PayloadTooLargeError, ValidationError } from '../../../../lib/errors';
import { MAX_PENDING_VEHICLES, getDraft, setDraft } from '../../../../lib/schema';
import {
  safeText,
  validateAdg,
  validateBrand,
  validatePeriodValue,
} from '../../../../lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_UPLOAD_ROWS = 50000;
const MAX_UPLOAD_COLUMNS = 64;
const MAX_MULTIPART_OVERHEAD = 1024 * 1024;

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

const HYBRID_KEYWORDS = ['HEV', 'HYBRID', 'PHEV', 'DM-I', 'DHT'];

function normalizeHeader(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildColumnMap(headerRow) {
  const normalized = headerRow.map(normalizeHeader);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const matches = normalized
      .map((header, index) => (aliases.includes(header) ? index : -1))
      .filter((index) => index !== -1);
    if (matches.length > 1) {
      throw new ValidationError(`The sheet contains more than one ${field} column.`);
    }
    if (matches.length === 1) map[field] = matches[0];
  }
  return map;
}

function cellText(row, index, field, maxLength = 1000) {
  const value = row[index];
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new ValidationError(`${field} contains an unsupported cell value.`);
  }
  return safeText(String(value), field, { maxLength, allowEmpty: true });
}

function normalizeAdg(raw) {
  if (raw === null || raw === undefined || raw === '') return '';
  let value;
  if (typeof raw === 'number') {
    if (!Number.isSafeInteger(raw) || raw < 0) {
      throw new ValidationError('ADG values must be whole numbers or strings.');
    }
    value = String(raw);
  } else if (typeof raw === 'string') {
    value = raw.trim();
    if (/^\d+\.0+$/.test(value)) value = value.split('.')[0];
  } else {
    throw new ValidationError('ADG values must be whole numbers or strings.');
  }

  if (!value) return '';
  if (/^\d+$/.test(value) && value.length < 8) value = value.padStart(8, '0');
  return validateAdg(value);
}

function extractWarrantyKmTime(warrantyText) {
  if (!warrantyText) return { warr_km: '', warr_time: '' };
  const match = warrantyText.match(/(\d+)\s*YEAR\/(\d[\d,]*)\s*KM/i);
  if (!match) return { warr_km: '', warr_time: '' };
  return {
    warr_time: String(parseInt(match[1], 10) * 12),
    warr_km: match[2].replace(/,/g, ''),
  };
}

function detectHybrid(desc) {
  const upper = desc.toUpperCase();
  return HYBRID_KEYWORDS.some((keyword) => upper.includes(keyword)) ? 'YES' : 'NO';
}

function getUploadMaxBytes() {
  return getBoundedInteger('MAX_UPLOAD_BYTES', 10 * 1024 * 1024, 1024, 25 * 1024 * 1024);
}

function readUploadRows(fileBuffer) {
  let workbook;
  try {
    workbook = XLSX.read(fileBuffer, { type: 'buffer', dense: true, cellFormula: false });
  } catch {
    throw new ValidationError('The uploaded file is not a readable Excel workbook.');
  }

  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
    throw new ValidationError('The workbook does not contain a worksheet.');
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new ValidationError('The first worksheet could not be read.');

  let rows;
  try {
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  } catch {
    throw new ValidationError('The first worksheet could not be read.');
  }
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new ValidationError('Sheet appears to be empty.');
  }
  if (rows.length > MAX_UPLOAD_ROWS) {
    throw new PayloadTooLargeError(`The sheet cannot contain more than ${MAX_UPLOAD_ROWS} rows.`);
  }
  if (!Array.isArray(rows[0]) || rows[0].length > MAX_UPLOAD_COLUMNS) {
    throw new ValidationError(`The header row cannot contain more than ${MAX_UPLOAD_COLUMNS} columns.`);
  }
  return rows;
}

function makeVehicle(row, rowNumber, colMap) {
  const adg = normalizeAdg(row[colMap.adg]);
  if (!adg) throw new ValidationError(`Row ${rowNumber} is missing an ADG code.`);

  const desc = colMap.desc === undefined ? '' : cellText(row, colMap.desc, `Row ${rowNumber} description`, 240);
  const suppliedBrand = colMap.brand === undefined
    ? ''
    : cellText(row, colMap.brand, `Row ${rowNumber} brand`, 80);
  if (!suppliedBrand && !desc) {
    throw new ValidationError(`Row ${rowNumber} must include a brand or description.`);
  }
  const brand = validateBrand(suppliedBrand || (desc.split(/\s+/)[0] || 'UNKNOWN').toUpperCase());
  const warranty = colMap.warranty === undefined
    ? ''
    : cellText(row, colMap.warranty, `Row ${rowNumber} warranty`, 1000);
  const parsedWarranty = extractWarrantyKmTime(warranty);
  const warrKm = colMap.warr_km === undefined
    ? parsedWarranty.warr_km
    : cellText(row, colMap.warr_km, `Row ${rowNumber} warranty km`, 32);
  const warrTime = colMap.warr_time === undefined
    ? parsedWarranty.warr_time
    : cellText(row, colMap.warr_time, `Row ${rowNumber} warranty time`, 32);

  return {
    brand,
    vehicle: {
      adg,
      cap: colMap.cap === undefined ? '' : cellText(row, colMap.cap, `Row ${rowNumber} capacity`, 32),
      hybrid: detectHybrid(desc),
      desc,
      range: colMap.range === undefined ? '' : cellText(row, colMap.range, `Row ${rowNumber} range`, 160),
      model: colMap.model === undefined ? '' : cellText(row, colMap.model, `Row ${rowNumber} model`, 160),
      warranty,
      warr_km: validatePeriodValue(warrKm, `Row ${rowNumber} warranty km`),
      warr_time: validatePeriodValue(warrTime, `Row ${rowNumber} warranty time`),
    },
  };
}

export async function POST(req) {
  try {
    const authorization = authorizeRequest(req, { mutation: true });
    if (!authorization.ok) return authResponse(authorization);

    const maxUploadBytes = getUploadMaxBytes();
    const contentLength = getContentLength(req);
    if (contentLength !== null && contentLength > maxUploadBytes + MAX_MULTIPART_OVERHEAD) {
      throw new PayloadTooLargeError(`Upload exceeds the ${maxUploadBytes} byte limit.`);
    }

    let form;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError('Invalid multipart upload.');
    }
    const formKeys = Array.from(form.keys());
    const files = form.getAll('file');
    if (formKeys.some((key) => key !== 'file') || files.length !== 1) {
      throw new ValidationError('A single Excel file is required.');
    }
    const file = files[0];
    if (!file || typeof file.arrayBuffer !== 'function' || typeof file.name !== 'string') {
      throw new ValidationError('A single Excel file is required.');
    }
    const fileName = safeText(file.name, 'file name', { maxLength: 255 });
    if (!/\.(xlsx|xls)$/i.test(fileName)) {
      throw new ValidationError('Only .xlsx and .xls files are supported.');
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new ValidationError('The uploaded file is empty or invalid.');
    }
    if (file.size > maxUploadBytes) {
      throw new PayloadTooLargeError(`Upload exceeds the ${maxUploadBytes} byte limit.`);
    }

    let fileBuffer;
    try {
      fileBuffer = Buffer.from(await file.arrayBuffer());
    } catch {
      throw new ValidationError('The uploaded file could not be read.');
    }
    if (fileBuffer.length === 0) throw new ValidationError('The uploaded file is empty.');
    if (fileBuffer.length > maxUploadBytes) {
      throw new PayloadTooLargeError(`Upload exceeds the ${maxUploadBytes} byte limit.`);
    }

    const rows = readUploadRows(fileBuffer);
    const colMap = buildColumnMap(rows[0]);
    if (colMap.adg === undefined) {
      throw new ValidationError('Could not find an ADG column in the sheet. Check the header row.');
    }
    if (colMap.brand === undefined && colMap.desc === undefined) {
      throw new ValidationError('The sheet must include a brand or description column.');
    }

    const draft = await getDraft();
    const existingAdgs = new Set();
    for (const vehicles of Object.values(draft.vehicles)) {
      for (const vehicle of vehicles) {
        if (vehicle.adg) existingAdgs.add(String(vehicle.adg));
      }
    }
    for (const vehicles of Object.values(draft.pending)) {
      for (const vehicle of vehicles) {
        if (vehicle.adg) existingAdgs.add(String(vehicle.adg));
      }
    }
    for (const adg of draft.ignored_adgs) existingAdgs.add(String(adg));

    const newlyFound = [];
    const pendingCount = Object.values(draft.pending)
      .reduce((count, vehicles) => count + vehicles.length, 0);
    for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex];
      if (!Array.isArray(row) || row.length > MAX_UPLOAD_COLUMNS) {
        throw new ValidationError(`Row ${rowIndex + 1} has too many columns.`);
      }
      if (row.every((value) => value === '' || value === null || value === undefined)) continue;

      const { brand, vehicle } = makeVehicle(row, rowIndex + 1, colMap);
      if (existingAdgs.has(vehicle.adg)) continue;
      if (pendingCount + newlyFound.length >= MAX_PENDING_VEHICLES) {
        throw new PayloadTooLargeError(`The pending queue cannot exceed ${MAX_PENDING_VEHICLES} vehicles.`);
      }

      if (!draft.pending[brand]) draft.pending[brand] = [];
      draft.pending[brand].push(vehicle);
      existingAdgs.add(vehicle.adg);
      newlyFound.push({ brand, ...vehicle });
    }

    await setDraft(draft);
    return NextResponse.json({
      ok: true,
      newCount: newlyFound.length,
      newVehicles: newlyFound,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
