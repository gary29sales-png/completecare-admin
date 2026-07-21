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

module.exports = { get, set };