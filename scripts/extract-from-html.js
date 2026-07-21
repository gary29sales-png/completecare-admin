// One-off utility: pulls FALLBACK_DATA / EXCLUSIONS / NO_CLUTCH_VEHICLES /
// ADG_EXCLUSION_OVERRIDES / CONFIRMED_BRANDS / OEM_ONLY_BRANDS out of a
// Complete Care HTML tool file and writes clean JSON into /data.
//
// Usage: node scripts/extract-from-html.js /path/to/CompleteCare_BM_Tool.html
//
// Only needed if you ever want to re-seed the admin tool's dataset from a
// snapshot of the existing HTML tool (e.g. if the two drift and you want
// to reset the admin tool to match the HTML exactly). Day-to-day updates
// should go through the admin UI instead.

const fs = require('fs');
const path = require('path');

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error('Usage: node scripts/extract-from-html.js <path-to-html>');
  process.exit(1);
}

const src = fs.readFileSync(htmlPath, 'utf8');

function extractBracketed(marker, openChar, closeChar) {
  const start = src.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length;
  let depth = 0, inStr = false, strChar = null, escaped = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (inStr) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === strChar) inStr = false;
      continue;
    } else {
      if (c === '"' || c === "'" || c === '`') { inStr = true; strChar = c; continue; }
      if (c === openChar) depth++;
      else if (c === closeChar) { depth--; if (depth === 0) { j++; break; } }
    }
  }
  return src.slice(i, j);
}

function parseConst(name) {
  const raw = extractBracketed(`const ${name} = `, src[src.indexOf(`const ${name} = `) + `const ${name} = `.length], null);
  return raw;
}

// FALLBACK_DATA and most others are `const NAME = { ... }` or `[ ... ]`.
function extractSimple(name) {
  const marker = `const ${name} = `;
  const start = src.indexOf(marker);
  if (start === -1) return null;
  const openChar = src[start + marker.length];
  const closeChar = openChar === '{' ? '}' : openChar === '[' ? ']' : null;
  if (!closeChar) return null;
  return extractBracketed(marker, openChar, closeChar);
}

// NO_CLUTCH_VEHICLES is `const NO_CLUTCH_VEHICLES = new Set([ ... ])`.
function extractSet(name) {
  const marker = `const ${name} = new Set([`;
  const start = src.indexOf(marker);
  if (start === -1) return null;
  return extractBracketed(marker.slice(0, -1), '[', ']');
}

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const vehicles = JSON.parse(extractSimple('FALLBACK_DATA'));
const exclusions = eval('(' + extractSimple('EXCLUSIONS') + ')');
const noClutch = eval('(' + extractSet('NO_CLUTCH_VEHICLES') + ')');
const adgOverrides = eval('(' + extractSimple('ADG_EXCLUSION_OVERRIDES') + ')');
const oemOnly = eval('(' + extractSimple('OEM_ONLY_BRANDS') + ')');
const confirmed = eval('(' + extractSimple('CONFIRMED_BRANDS') + ')');

fs.writeFileSync(path.join(dataDir, 'vehicles.json'), JSON.stringify(vehicles, null, 2));
fs.writeFileSync(path.join(dataDir, 'exclusions.json'), JSON.stringify(exclusions, null, 2));
fs.writeFileSync(path.join(dataDir, 'no_clutch_vehicles.json'), JSON.stringify(noClutch, null, 2));
fs.writeFileSync(path.join(dataDir, 'adg_exclusion_overrides.json'), JSON.stringify(adgOverrides, null, 2));
fs.writeFileSync(path.join(dataDir, 'oem_only_brands.json'), JSON.stringify(oemOnly, null, 2));
fs.writeFileSync(path.join(dataDir, 'confirmed_brands.json'), JSON.stringify(confirmed, null, 2));

console.log('Extracted', Object.keys(vehicles).length, 'brands,',
  Object.values(vehicles).reduce((a, b) => a + b.length, 0), 'vehicles.');
