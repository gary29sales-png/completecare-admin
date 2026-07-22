// Storage abstraction. Uses Supabase (Postgres) when configured (production),
// falls back to local JSON files under /data for local dev and for
// running/testing this app before it's deployed.
//
// Requires a table in Supabase:
//
//   create table kv_store (
//     key text primary key,
//     value jsonb not null,
//     updated_at timestamptz not null default now()
//   );
//
// Env vars expected: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (service role key, not the anon key — this runs server-side only and
// needs to read/write without Row Level Security getting in the way).

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const USE_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

let supabase = null;
if (USE_SUPABASE) {
  // Lazy require so local dev without Supabase env vars doesn't crash.
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

function localPath(key) {
  return path.join(DATA_DIR, key.replace(/:/g, '__') + '.json');
}

async function get(key) {
  if (USE_SUPABASE) {
    const { data, error } = await supabase
      .from('kv_store')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error('Supabase get failed for "' + key + '": ' + error.message);
    return data ? data.value : null;
  }
  const p = localPath(key);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function set(key, value) {
  if (USE_SUPABASE) {
    const { error } = await supabase
      .from('kv_store')
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw new Error('Supabase set failed for "' + key + '": ' + error.message);
    return;
  }
  const p = localPath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
}

// Atomic "create only if this key doesn't already exist" — used for
// first-time seeding. Unlike a plain get-then-set, this can never
// clobber real data: if the row already exists, the insert is rejected
// by the database itself (unique constraint on `key`), and we simply
// fetch and return whatever is actually there instead.
async function setIfMissing(key, value) {
  if (USE_SUPABASE) {
    const { error } = await supabase
      .from('kv_store')
      .insert({ key, value, updated_at: new Date().toISOString() });
    if (error) {
      // 23505 = unique_violation — someone else already created this row
      // (or it already existed); that's fine, just return what's there.
      if (error.code === '23505') {
        return await get(key);
      }
      throw new Error('Supabase setIfMissing failed for "' + key + '": ' + error.message);
    }
    return value;
  }
  const p = localPath(key);
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
  return value;
}

module.exports = { get, set, setIfMissing };