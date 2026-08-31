# Complete Care Admin

Production-ready admin/API backend for the Complete Care Compatibility Guide.
The separately deployed guide reads the published vehicle dataset from this
service; the guide HTML is not modified here.

## Endpoints

- **`GET /api/vehicles`** - public, read-only six-key contract:
  `vehicles`, `exclusions`, `no_clutch_vehicles`,
  `adg_exclusion_overrides`, `confirmed_brands`, and `oem_only_brands`.
  Duplicate vehicle rows and string ADGs (including leading zeros) are
  preserved. The response has exact-origin CORS, ETag support, and a short
  cache lifetime.
- **`OPTIONS /api/vehicles`** - exact-origin CORS preflight.
- **`/admin`** - internal password-gated workflow for upload, categorization,
  and publish.
- **`GET /healthz`** - readiness/health check. `/readyz` and
  `/api/healthz` are equivalent aliases.

## Data and publishing

The six JSON files under `data/` are the trusted seed snapshot extracted from
the latest Complete Care HTML. They seed `cc:published` once in an empty
store. The Supabase `kv_store` table then holds:

- `cc:published` - the live six-key public contract.
- `cc:draft` - the live data plus pending and ignored admin queue state.

Uploading and categorizing only changes the draft. Clicking **Publish** is the
only operation that updates the public dataset.

## Local development

Node 22 is required by the lockfile and is pinned by `package.json` and the
container image.

```powershell
npm ci
Copy-Item .env.example .env.local
# Set NODE_ENV=development, ADMIN_PASSWORD, and ADMIN_SESSION_SECRET.
npm run dev
```

When `NODE_ENV` is not `production` and both Supabase variables are omitted,
the app uses local JSON state files under `.local-data/` and the checked-in
seed files under `data/`. This fallback is intentionally
unavailable in production. To refresh the checked-in seed from a trusted HTML
snapshot:

```powershell
node scripts/extract-from-html.js C:\path\CompleteCare_BM_Tool.html
```

## Production deployment

Apply `supabase/migrations/20260831120000_create_kv_store.sql`, then provide
the variables in `.env.example` through the deployment secret manager. At
minimum production requires `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and
`ADMIN_ORIGIN`. Set `PUBLIC_ALLOWED_ORIGINS` to comma-separated exact origins
for the separately hosted guide; do not use `*`.

The guide points at this service with `COMPLETECARE_API_URL` (or its
`COMPLETECARE_DATA_ENDPOINT` alias), configured as the admin base URL or the
complete `/api/vehicles` URL. CORS is configured here with the guide's browser
origin, not with that API URL.

The internal deployment is container-first:

```powershell
docker build -t completecare-admin:latest .
docker run --rm -p 3000:3000 --env-file .env completecare-admin:latest
```

TLS should terminate at the internal reverse proxy. Forward the external
`Host`, `Origin`, and `X-Forwarded-Proto` headers, set `TRUST_PROXY=true` only
for a trusted proxy, and keep the service-role key in the platform secret
store. The container health check uses `/healthz`.

See [docs/deployment.md](docs/deployment.md) for the Supabase contract,
reverse-proxy requirements, security controls, limits, and operational
runbook.

## Weekly workflow

1. Log in at `/admin`.
2. Upload the weekly `.xlsx` or `.xls` sheet. The bounded parser checks the
   header and rows and queues ADGs not already published, pending, or ignored.
3. Categorize each pending vehicle as standard, a brand exclusion table, an
   ADG override, and/or no-clutch.
4. Click **Publish** when the draft is ready.
