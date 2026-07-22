const store = require('./store');
const path = require('path');
const fs = require('fs');

// The 9 fixed component categories the admin selects from when building
// or editing a brand's exclusion table.
const COMPONENT_CATEGORIES = [
  'Clutch',
  '12V Battery',
  'Management System',
  'Exhaust System / Catalytic Converter',
  'Suspension',
  'Steering Mechanism',
  'Drive Shafts / CV Joints',
  'Wheel Bearings',
  'Viscous & Electric Fans',
];

function loadSeedFile(name) {
  const p = path.join(process.cwd(), 'data', name + '.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Builds the full published-state object from the one-time seed files
// (extracted from the existing Traficc HTML tool). Only used the very
// first time the app runs against an empty store.
function buildSeedState() {
  return {
    vehicles: loadSeedFile('vehicles'),
    exclusions: loadSeedFile('exclusions'),
    no_clutch_vehicles: loadSeedFile('no_clutch_vehicles'),
    adg_exclusion_overrides: loadSeedFile('adg_exclusion_overrides'),
    confirmed_brands: loadSeedFile('confirmed_brands'),
    oem_only_brands: loadSeedFile('oem_only_brands'),
  };
}

async function getPublished() {
  let state = await store.get('cc:published');
  if (!state) {
    state = await store.setIfMissing('cc:published', buildSeedState());
  }
  return state;
}

async function getDraft() {
  let draft = await store.get('cc:draft');
  if (!draft) {
    // Draft starts as a copy of published, plus an empty pending queue
    // for newly-discovered vehicles awaiting categorization. Using
    // setIfMissing here (not a plain read-then-write) means that even
    // if this branch runs more than once concurrently, it can never
    // overwrite a real draft that already has pending vehicles in it.
    const published = await getPublished();
    draft = await store.setIfMissing('cc:draft', { ...published, pending: {}, ignored_adgs: [] });
  }
  // Backward-compatible: drafts created before this field existed won't
  // have it yet.
  if (!Array.isArray(draft.ignored_adgs)) draft.ignored_adgs = [];
  return draft;
}

async function setDraft(draft) {
  await store.set('cc:draft', draft);
}

async function publishDraft() {
  const draft = await getDraft();
  // Publishing drops the pending queue and the ignore list — neither is
  // meaningful once live, only categorized vehicles that have been
  // merged into draft.vehicles go live.
  const { pending, ignored_adgs, ...published } = draft;
  await store.set('cc:published', published);
  await store.set('cc:draft', { ...published, pending: {}, ignored_adgs: [] });
  return published;
}

module.exports = {
  COMPONENT_CATEGORIES,
  getPublished,
  getDraft,
  setDraft,
  publishDraft,
};