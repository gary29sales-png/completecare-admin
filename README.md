# Complete Care Admin

Backend for the Complete Care Compatibility Guide. Replaces the "edit the HTML
by hand" workflow with: upload the weekly Excel → admin flags new ADGs →
you categorize them → publish → both BM tools pick it up automatically.

## What this is

- **`/api/vehicles`** — public read-only endpoint. This is what the Traficc
  and Avis BM tools should fetch on load instead of embedding `FALLBACK_DATA`
  directly in the HTML. (Wiring the HTML tools to fetch from here instead of
  their embedded blob is the next piece of work — this repo is the backend
  half.)
- **`/admin`** — password-gated admin UI: upload sheet, review pending
  vehicles, categorize them, publish.
- **Staged publishing** — uploads and categorization edit a *draft*. Nothing
  reaches the live BM tools until you click Publish.

## Data model

Seeded once from the current Traficc HTML tool (`data/*.json`), then lives
in Redis (Vercel/Upstash) once deployed:

- `vehicles` — brand → array of vehicle objects (adg, desc, warranty, etc.)
- `exclusions` — brand → `{ status, items: [{ component, factory }] }`.
  One shared component/drop-off table per brand.
- `no_clutch_vehicles` — array of vehicle `desc` strings that suppress the
  clutch exclusion row (DHT/CVT/automatic).
- `adg_exclusion_overrides` — ADG → override drop-off period string, for
  individual vehicles that are exceptions to their brand's standard table.
- `confirmed_brands` / `oem_only_brands` — brand status lists.

## Local development

```
npm install
ADMIN_PASSWORD=whatever npm run dev
```

Without Redis env vars set, data is stored as local JSON files under `/data`
(fine for local testing, not for production — a serverless deploy has no
persistent disk).

## Deploying to Vercel

1. Push this repo to GitHub, import it into a new Vercel project.
2. Add a Redis store: Vercel dashboard → Storage → add the **Upstash for
   Redis** integration (or any Redis you like) to this project. That sets
   `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` — either naming works, see `lib/store.js`)
   automatically.
3. Add an environment variable `ADMIN_PASSWORD` — whatever you want to log
   into `/admin` with.
4. Deploy. First hit to `/api/vehicles` or `/admin` seeds Redis from the
   `data/*.json` files baked into the deployment.

## Weekly workflow

1. Go to `/admin`, log in.
2. Upload the Monday Excel sheet. It scans for ADG codes not already in the
   dataset (published or already-pending) and buckets new ones by brand.
3. Click a brand, click a vehicle, categorize it:
   - **Standard** (brand already confirmed): just adds the vehicle as-is.
   - **Build exclusion table** (new/unconfirmed brand, or you're
     deliberately reworking a brand's table): tick the applicable
     components from the fixed list, enter drop-off months/km for each.
   - **ADG override**: for a vehicle that's an exception to its brand's
     usual drop-off period — enter the override period for this ADG only.
   - Tick "DHT / CVT / automatic" if the clutch row should be suppressed
     for this vehicle.
4. Repeat for each pending vehicle.
5. Click **Publish**. This is the only step that affects what BMs see.

## Known gaps / next steps

- The Traficc and Avis HTML tools still need to be changed to `fetch('/api/vehicles')`
  instead of embedding `FALLBACK_DATA` — that's the piece that actually
  retires manual HTML editing.
- Excel column-name matching (`app/api/admin/upload/route.js`,
  `HEADER_ALIASES`) was built from your description of the sheet, not a
  real sample. Send a real weekly export and I'll tighten it up.
- No audit trail yet on who categorized what — fine for a single admin user,
  worth adding if anyone else gets access.
- `scripts/extract-from-html.js` lets you re-seed `/data` from a fresh copy
  of the HTML tool if you ever need to reset the admin dataset to match it
  exactly.
