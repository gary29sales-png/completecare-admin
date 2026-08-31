# Complete Care deployment and security

Complete Care Admin is the internal API/admin service for the separately deployed
Complete Care guide. It is not the static guide itself.

## Required production configuration

Apply `supabase/migrations/20260831120000_create_kv_store.sql` to the Supabase
project used by the service. The application stores two rows in `kv_store`:
`cc:published` and `cc:draft`. The service-role key is server-only and must
never be exposed to the browser.

Set the variables in `.env.example` through the deployment secret store:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for `kv_store` |
| `ADMIN_PASSWORD` | Password accepted by the internal admin login |
| `ADMIN_SESSION_SECRET` | HMAC secret for stateless signed admin sessions |
| `ADMIN_ORIGIN` | Exact browser origin allowed to mutate the admin API |
| `PUBLIC_ALLOWED_ORIGINS` | Comma-separated exact origins allowed to read `/api/vehicles` |
| `TRUST_PROXY` | Set to `true` only behind a trusted reverse proxy |

Production startup fails when Supabase or the admin session/origin configuration
is missing. There is no production local-file fallback. Outside production, omitting the Supabase variables uses local JSON state files
alongside the checked-in seed files for local development only.

Generate the session secret with a secret manager or a command such as
`openssl rand -base64 32`. Rotate `ADMIN_SESSION_SECRET` to invalidate existing
sessions. Rotate `ADMIN_PASSWORD` independently.

## Container and reverse proxy

The supplied Dockerfile pins the runtime to Node `22.23.2` and exposes port
`3000`. Build and run it with secrets supplied by the platform:

```powershell
docker build -t completecare-admin:latest .
docker run --rm -p 3000:3000 --env-file .env completecare-admin:latest
```

Terminate TLS at the internal reverse proxy and forward only to the container.
Preserve the external `Host`, `Origin`, and `X-Forwarded-Proto` headers, and set
`TRUST_PROXY=true` only when that proxy is the sole trusted source of forwarded
headers. Restrict ingress to the internal admin and guide networks; do not
publish the Supabase service-role key or container port directly to the public
internet.

Use `GET /healthz` for container health and readiness. It checks required
production configuration and performs a `kv_store` query. A non-200 response
means the instance must not receive traffic. `/readyz` and `/api/healthz` are
equivalent aliases.

The built-in login limiter is process-local and a secondary safeguard. Enforce
additional per-IP/request limits at the reverse proxy for replicated
deployments.

## Public guide API

`GET /api/vehicles` returns the six-key published contract:

`vehicles`, `exclusions`, `no_clutch_vehicles`, `adg_exclusion_overrides`,
`confirmed_brands`, and `oem_only_brands`.

The endpoint preserves duplicate vehicle rows and string ADGs, including leading
zeros. It emits an ETag and a short public cache lifetime. Configure
`PUBLIC_ALLOWED_ORIGINS` with exact `https://...` origins for the separate guide;
wildcards are rejected in production. `OPTIONS /api/vehicles` responds only for
an allowed origin.

The standalone guide uses `COMPLETECARE_API_URL` (with
`COMPLETECARE_DATA_ENDPOINT` as its alias). Set it to this service's base URL
or the complete `/api/vehicles` URL; the guide sends no cookies or authorization
header. The origin of the guide deployment, not the API URL itself, belongs in
`PUBLIC_ALLOWED_ORIGINS`.

## Admin workflow and request protections

Uploads and categorization modify `cc:draft` only. `/api/admin/publish` copies
the categorized draft into `cc:published`; pending items remain out of the
public response.

Admin sessions are signed, expiring HMAC tokens and do not contain the password.
A separate CSRF cookie is issued at login. Every authenticated mutation checks
the session and the request `Origin`/`Referer` or a matching CSRF header. Login
attempts are rate-limited; apply ingress rate limits as well.

Uploads are limited to Excel extensions and a bounded byte/row/column count.
Headers, ADGs, text fields, numeric warranty fields, and mutation bodies are
validated before a draft is written. Malformed requests return explicit 4xx
responses.
