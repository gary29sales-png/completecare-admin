// Persistent key/value storage for the published and draft datasets.
//
// Production is deliberately Supabase-only. The local JSON backend exists
// only for non-production development and smoke testing.

const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { ConfigurationError, StorageError } = require('./errors');
const { isProduction } = require('./config');

const SEED_DIR = path.join(process.cwd(), 'data');
const DATA_DIR = process.env.LOCAL_DATA_DIR
  ? path.resolve(process.env.LOCAL_DATA_DIR)
  : path.join(process.cwd(), '.local-data');
const KEY_PATTERN = /^[a-z0-9:_-]{1,128}$/;
let supabase;
let supabaseConfig;

function getSupabaseConfig() {
  const url = typeof process.env.SUPABASE_URL === 'string'
    ? process.env.SUPABASE_URL.trim()
    : '';
  const serviceRoleKey = typeof process.env.SUPABASE_SERVICE_ROLE_KEY === 'string'
    ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim()
    : '';

  if (isProduction() && (!url || !serviceRoleKey)) {
    throw new ConfigurationError(
      'Production storage requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }
  if ((url && !serviceRoleKey) || (!url && serviceRoleKey)) {
    throw new ConfigurationError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together.'
    );
  }
  if (!url && !serviceRoleKey) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigurationError('SUPABASE_URL must be a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new ConfigurationError('SUPABASE_URL must use http(s).');
  }

  return { url, serviceRoleKey };
}

function getSupabaseClient(config) {
  const configKey = `${config.url}\u0000${config.serviceRoleKey}`;
  if (supabase && supabaseConfig === configKey) return supabase;

  // Lazy-load the SDK so local development does not need to initialize a
  // remote client when it is using the JSON backend.
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(config.url, config.serviceRoleKey, {
    global: {
      fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }),
    },
  });
  supabaseConfig = configKey;
  return supabase;
}

function getBackend() {
  const config = getSupabaseConfig();
  return config ? { name: 'supabase', client: getSupabaseClient(config) } : { name: 'local' };
}

function localPath(key) {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return path.join(DATA_DIR, `${key.replace(/:/g, '__')}.json`);
}

function readLocal(key) {
  const filePath = localPath(key);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new StorageError(`Local storage read failed for "${key}": ${error.message}`);
  }
}

function writeLocal(key, value) {
  const filePath = localPath(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw new StorageError(`Local storage write failed for "${key}": ${error.message}`);
  }
}

async function get(key) {
  const backend = getBackend();
  if (backend.name === 'supabase') {
    const { data, error } = await backend.client
      .from('kv_store')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new StorageError(`Supabase get failed for "${key}": ${error.message}`);
    return data ? data.value : null;
  }
  return readLocal(key);
}

async function set(key, value) {
  const backend = getBackend();
  if (backend.name === 'supabase') {
    const { error } = await backend.client
      .from('kv_store')
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw new StorageError(`Supabase set failed for "${key}": ${error.message}`);
    return;
  }
  writeLocal(key, value);
}

// Atomic "create only if this key doesn't already exist" for first-time
// seeding. The database primary key and local exclusive file creation both
// prevent concurrent initialization from overwriting real data.
async function setIfMissing(key, value) {
  const backend = getBackend();
  if (backend.name === 'supabase') {
    const { error } = await backend.client
      .from('kv_store')
      .insert({ key, value, updated_at: new Date().toISOString() });
    if (error) {
      if (error.code === '23505') return await get(key);
      throw new StorageError(`Supabase setIfMissing failed for "${key}": ${error.message}`);
    }
    return value;
  }

  const filePath = localPath(key);
  if (fs.existsSync(filePath)) return readLocal(key);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, 'wx');
    fs.writeFileSync(descriptor, JSON.stringify(value, null, 2), 'utf8');
    return value;
  } catch (error) {
    if (error.code === 'EEXIST') return readLocal(key);
    if (descriptor !== undefined && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    throw new StorageError(`Local storage setIfMissing failed for "${key}": ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

async function check() {
  const backend = getBackend();
  if (backend.name === 'supabase') {
    const { error } = await backend.client
      .from('kv_store')
      .select('key')
      .limit(1);
    if (error) throw new StorageError(`Supabase readiness check failed: ${error.message}`);
    return { backend: 'supabase' };
  }

  const requiredSeedFiles = [
    'vehicles.json',
    'exclusions.json',
    'no_clutch_vehicles.json',
    'adg_exclusion_overrides.json',
    'confirmed_brands.json',
    'oem_only_brands.json',
  ];
  for (const file of requiredSeedFiles) {
    const filePath = path.join(SEED_DIR, file);
    if (!fs.existsSync(filePath)) {
      throw new StorageError(`Local seed file is missing: ${file}`);
    }
  }
  return { backend: 'local' };
}

function backendName() {
  return getBackend().name;
}

module.exports = {
  get,
  set,
  setIfMissing,
  check,
  backendName,
};
