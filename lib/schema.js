const store = require('./store');
const path = require('path');
const fs = require('fs');
const { ValidationError } = require('./errors');
const { isPlainObject, safeText } = require('./validation');

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

const PUBLISHED_KEYS = [
  'vehicles',
  'exclusions',
  'no_clutch_vehicles',
  'adg_exclusion_overrides',
  'confirmed_brands',
  'oem_only_brands',
];

const MAX_VEHICLES_PER_BRAND = 100000;
const MAX_PENDING_VEHICLES = 50000;

function loadSeedFile(name) {
  const filePath = path.join(process.cwd(), 'data', `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Seed file "${name}.json" could not be loaded: ${error.message}`);
  }
}

function validatePublishedState(state) {
  if (!isPlainObject(state)) throw new ValidationError('Published state must be an object.', 500);
  for (const key of PUBLISHED_KEYS) {
    if (!(key in state)) {
      throw new ValidationError(`Published state is missing "${key}".`, 500);
    }
  }

  if (!isPlainObject(state.vehicles)) {
    throw new ValidationError('Published vehicles must be an object.', 500);
  }
  for (const [brand, vehicles] of Object.entries(state.vehicles)) {
    safeText(brand, 'vehicle brand', { maxLength: 80 });
    if (!Array.isArray(vehicles) || vehicles.length > MAX_VEHICLES_PER_BRAND) {
      throw new ValidationError(`Published vehicles for ${brand} are invalid.`, 500);
    }
    for (const [index, vehicle] of vehicles.entries()) {
      if (!isPlainObject(vehicle) || typeof vehicle.adg !== 'string') {
        throw new ValidationError(`Published vehicle ${brand}[${index}] is invalid.`, 500);
      }
    }
  }

  if (!isPlainObject(state.exclusions)
    || !Array.isArray(state.no_clutch_vehicles)
    || !isPlainObject(state.adg_exclusion_overrides)
    || !Array.isArray(state.confirmed_brands)
    || !Array.isArray(state.oem_only_brands)) {
    throw new ValidationError('Published state contains invalid collection types.', 500);
  }
  if (!state.no_clutch_vehicles.every((value) => typeof value === 'string')) {
    throw new ValidationError('Published no_clutch_vehicles contains an invalid value.', 500);
  }
  if (!Object.values(state.adg_exclusion_overrides).every((value) => typeof value === 'string')) {
    throw new ValidationError('Published adg_exclusion_overrides contains an invalid value.', 500);
  }
  if (!state.confirmed_brands.every((value) => typeof value === 'string')
    || !state.oem_only_brands.every((value) => (
      typeof value === 'string'
      || (isPlainObject(value)
        && typeof value.name === 'string'
        && (value.status === undefined || typeof value.status === 'string'))
    ))) {
    throw new ValidationError('Published brand lists contain an invalid value.', 500);
  }

  return state;
}

function toPublishedContract(state) {
  validatePublishedState(state);
  return {
    vehicles: state.vehicles,
    exclusions: state.exclusions,
    no_clutch_vehicles: state.no_clutch_vehicles,
    adg_exclusion_overrides: state.adg_exclusion_overrides,
    confirmed_brands: state.confirmed_brands,
    oem_only_brands: state.oem_only_brands,
  };
}

function buildSeedState() {
  return toPublishedContract({
    vehicles: loadSeedFile('vehicles'),
    exclusions: loadSeedFile('exclusions'),
    no_clutch_vehicles: loadSeedFile('no_clutch_vehicles'),
    adg_exclusion_overrides: loadSeedFile('adg_exclusion_overrides'),
    confirmed_brands: loadSeedFile('confirmed_brands'),
    oem_only_brands: loadSeedFile('oem_only_brands'),
  });
}

function validateDraft(draft) {
  toPublishedContract(draft);
  if (!isPlainObject(draft.pending)) {
    throw new ValidationError('Draft pending queue is invalid.', 500);
  }
  let pendingCount = 0;
  for (const [brand, vehicles] of Object.entries(draft.pending)) {
    safeText(brand, 'pending brand', { maxLength: 80 });
    if (!Array.isArray(vehicles)) throw new ValidationError(`Pending queue for ${brand} is invalid.`, 500);
    pendingCount += vehicles.length;
    if (pendingCount > MAX_PENDING_VEHICLES) {
      throw new ValidationError('Draft pending queue exceeds the configured limit.', 500);
    }
    for (const vehicle of vehicles) {
      if (!isPlainObject(vehicle) || typeof vehicle.adg !== 'string') {
        throw new ValidationError(`Pending vehicle for ${brand} is invalid.`, 500);
      }
    }
  }
  if (!Array.isArray(draft.ignored_adgs)
    || !draft.ignored_adgs.every((value) => typeof value === 'string')) {
    throw new ValidationError('Draft ignored_adgs is invalid.', 500);
  }
  return draft;
}

async function getPublished() {
  let state = await store.get('cc:published');
  if (!state) state = await store.setIfMissing('cc:published', buildSeedState());
  return toPublishedContract(state);
}

async function getDraft() {
  let draft = await store.get('cc:draft');
  if (!draft) {
    const published = await getPublished();
    draft = await store.setIfMissing('cc:draft', { ...published, pending: {}, ignored_adgs: [] });
  }
  if (!Object.prototype.hasOwnProperty.call(draft, 'ignored_adgs')) draft.ignored_adgs = [];
  if (!Object.prototype.hasOwnProperty.call(draft, 'pending')) draft.pending = {};
  return validateDraft(draft);
}

async function setDraft(draft) {
  validateDraft(draft);
  await store.set('cc:draft', draft);
}

async function publishDraft() {
  const draft = await getDraft();
  const published = toPublishedContract(draft);
  await store.set('cc:published', published);
  await store.set('cc:draft', { ...published, pending: {}, ignored_adgs: [] });
  return published;
}

module.exports = {
  COMPONENT_CATEGORIES,
  PUBLISHED_KEYS,
  MAX_PENDING_VEHICLES,
  getPublished,
  getDraft,
  setDraft,
  publishDraft,
  buildSeedState,
  toPublishedContract,
};
