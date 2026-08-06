# Cloudflare acceptance deployment

This runbook verifies the same deployment path used by the local command and a
Deploy to Cloudflare button. Cloudflare Access is optional and remains a manual
post-deployment control.

## Responsibility boundary

The deploy script accepts one application hostname and derives the sites
hostname as `sites.<application-hostname>`. It builds the reviewed Worker,
configures exactly those two Custom Domains, disables `workers.dev` and preview
URLs, and derives the Worker name by replacing dots in the application hostname
with hyphens. The automatically provisioned `SITES` R2 bucket uses that Worker
name with a `-sites` suffix. Longer names are shortened with a stable hash to
stay within Cloudflare's resource-name limits.

The R2 bucket is not a public origin. Confirm that its `r2.dev` URL is disabled
and that no R2 custom domain is attached. The Worker decides whether an active,
unexpired site object may be returned.

Without optional Access protection, both Worker domains are intentionally
public. Do not use private acceptance fixtures.

## Prerequisites

- The chosen hostname belongs to an active Cloudflare zone in the authenticated
  account.
- R2 has been enabled once for the account.
- Wrangler is authenticated locally, or `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` are available to automation.

## Validate without mutation

Run the repository checks and the shared deploy path in dry-run mode:

```sh
pnpm run check
pnpm test
pnpm run deploy -- --domain webdrop.example.com --dry-run
git diff --check
```

The command must report these derived targets:

```text
Application: https://webdrop.example.com
Published sites: https://sites.webdrop.example.com
Worker: webdrop-example-com
R2 bucket: webdrop-example-com-sites
```

The script rejects URLs, paths, wildcards, single-label names, placeholders,
and conflicting values from `--domain`, `APP_DOMAIN`, or the generated Wrangler
configuration.

## Deploy

Inventory the account and confirm the two hostnames are unused. Then run:

```sh
pnpm run deploy -- --domain webdrop.example.com
```

The script is the source of truth for both local and button deployments. A
Deploy to Cloudflare setup form writes the same value to `APP_DOMAIN`, after
which it invokes `pnpm run deploy` without an argument.

After deployment, verify:

1. The Worker has exactly the application and derived sites Custom Domains.
2. `workers.dev` and preview URLs are disabled.
3. One R2 bucket is bound as `SITES`, with `r2.dev` disabled and no R2 custom
   domain.
4. The daily `0 3 * * *` UTC cleanup trigger is present.

## Optional Cloudflare Access

The default deployment is public. To restrict a deployment after the Worker
exists:

1. In Zero Trust, go to **Access controls > Applications** and create a
   **Self-hosted and private** application.
2. Choose **Workers** and select the deployed Worker. Protect the Worker itself,
   not only one hostname or preview deployment.
3. Add an Allow policy limited to the intended testers. Do not add Everyone,
   Bypass, or Service Auth policies.
4. In a private browser, verify that both the application root and an exact
   sites URL are challenged before any Worker response is returned.

Worker-level Access covers requests routed to both Custom Domains. If Access is
not enabled, record its acceptance checks as not applicable rather than passed.

## Acceptance procedure

Copy the result template and leave every performed check as `NOT RUN` until its
result is observed:

```sh
cp ops/cloudflare/acceptance-results.example.md \
  ops/cloudflare/acceptance-results.md
```

Use a fixture directory containing no private information.

1. Open the application hostname, publish the fixture, and record the returned
   sites URL and expiry.
2. Open the returned URL before expiry and confirm the approved files are
   served.
3. Confirm an unknown hostname cannot reach either application surface.
4. Confirm the R2 metadata and content prefix exist without recording object
   bodies.
5. After expiry, confirm the same sites URL returns 404.
6. After a scheduled 03:00 UTC cleanup, confirm the metadata key and site prefix
   have been removed. A local scheduled invocation does not prove live Cron
   delivery.
7. If Access was enabled, perform the authenticated and unauthenticated checks
   in the previous section.

## Rollback

Record the previous Worker version before a deployment. `wrangler rollback`
does not remove Custom Domains, Access applications, Cron configuration, or R2
objects. If the environment must be withdrawn, remove the Worker Custom Domains
before disabling Access so an unprotected route is never left active. Preserve
the R2 bucket unless deletion is separately authorized.

## What this acceptance does not prove

- Production availability, alerting, or cleanup timeliness guarantees.
- Access enforcement when optional Access was not configured.
- Site-to-site isolation beyond the tested Worker behavior.
- Live Cron delivery until the scheduled run is observed.
- Absence of private data unless the fixture was independently reviewed.
