create table if not exists public.kv_store (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint kv_store_key_length check (char_length(key) between 1 and 128),
  constraint kv_store_value_shape check (jsonb_typeof(value) in ('object', 'array'))
);

alter table public.kv_store enable row level security;

revoke all on table public.kv_store from public, anon, authenticated;
grant select, insert, update, delete on table public.kv_store to service_role;
