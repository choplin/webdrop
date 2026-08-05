# Limited Cloudflare environment

This runbook creates and accepts one limited Webdrop environment. It does not
automate Cloudflare infrastructure changes. Stop before every dashboard or
Wrangler mutation and reconfirm the exact account, zone, hostnames, bucket, and
Worker name with the operator.

## Responsibility boundary

Cloudflare Access authenticates browser users before requests reach the Worker.
The Worker trusts that deployment boundary; it does not validate Access JWTs.
The Worker still separates control and pages traffic by exact hostname and
returns 404 for every other hostname.

The R2 bucket is not a public origin. Only the Worker binding reads and writes
objects. Access protects the two Worker custom domains, while the Worker decides
whether an active, unexpired site object may be returned.

Read-time expiry stops delivery immediately. The daily Cron Trigger performs
deferred physical deletion, so a 404 after expiry does not prove that R2 objects
have already been removed.

## Prepare the local configuration

1. Copy the tracked template to the ignored configuration:

   ```sh
   cp ops/cloudflare/wrangler.limited.example.jsonc \
     ops/cloudflare/wrangler.limited.jsonc
   ```

2. Replace the account ID, two `.example.invalid` hostnames, and R2 bucket
   placeholder. The two hostnames must be different custom domains in one
   Cloudflare zone. Do not add a wildcard route.
3. Review the diff without printing credentials. The file contains public
   resource identifiers but remains untracked to prevent accidental reuse in a
   different environment.
4. Validate and bundle without changing Cloudflare:

   ```sh
   pnpm run check
   pnpm test
   pnpm run check:limited
   git diff --check
   ```

`check:limited` rejects template values, alternate Worker endpoints, unexpected
routes, a public-origin overlap, the wrong R2 binding, or a changed Cron Trigger.
It then builds the assets and runs `wrangler deploy --dry-run` into `.wrangler/`.

## Authenticate and inventory without mutation

Run authentication in the operator's interactive terminal. Do not paste tokens
into this repository, shell history, or the acceptance record.

```sh
pnpm exec wrangler login
pnpm exec wrangler whoami
pnpm exec wrangler r2 bucket list
pnpm exec wrangler deployments list \
  --config ops/cloudflare/wrangler.limited.jsonc
```

Record only display names and the previous Worker version in a copy of
`ops/cloudflare/acceptance-results.example.md`. Confirm that the authenticated
account owns the configured zone and bucket.

## Configure the limited Cloudflare targets

These steps mutate Cloudflare. Before each group, show the exact targets to the
operator and obtain explicit approval.

1. In R2, create or select only the approved bucket. Under bucket settings,
   confirm that the public development URL is disabled and no custom domain is
   connected. Do not upload acceptance fixture content through the dashboard.
2. In Zero Trust, create one self-hosted Access application for the complete
   control hostname and another for the complete pages hostname. Attach an Allow
   policy limited to the approved test identities or their approved identity
   group. Do not add Everyone, Bypass, or Service Auth rules.
3. Inventory every Access application whose path overlaps either hostname, not
   only the two new applications. Remove or disable any more-specific application
   such as `control.example.com/publish` or `pages.example.com/p/*` before the
   Worker domains become reachable. A more-specific Access application path does
   not inherit the broader application's policy and could otherwise retain an
   Everyone, Bypass, or Service Auth rule.
4. Re-open the two complete-hostname applications. Verify their paths cover the
   entire hostname, their Allow rules contain only the approved identities or
   group, and the overlap inventory is empty.
5. Reconfirm the generated plan: exactly two custom domains, `workers_dev` and
   preview URLs disabled, one `SITES` binding, and one daily 03:00 UTC trigger.
6. Deploy only after explicit approval of that plan:

   ```sh
   pnpm exec wrangler deploy \
     --config ops/cloudflare/wrangler.limited.jsonc \
     --strict
   ```

After deploy, inspect the Worker settings and both R2 public-access controls in
the dashboard. Configuration success alone does not prove that alternate public
paths are absent.

## Acceptance procedure

Copy the result template and leave every row as `NOT RUN` until its action has
actually been observed:

```sh
cp ops/cloudflare/acceptance-results.example.md \
  ops/cloudflare/acceptance-results.md
```

Use a fixture directory that contains no private information.

1. In the creator's authenticated browser session, open the control hostname,
   publish the fixture, and record the returned pages hostname and expiry time.
2. Before activation evidence is available, do not claim the uploading-state
   check. The repository's deterministic test covers the write ordering; live
   acceptance requires an independently observable interrupted upload.
3. In a separate browser profile authenticated as the second identity, open the
   returned pages URL before expiry.
4. In a private browser session with no Access cookies, open the control root and
   the exact returned `/p/<site>/` pages URL. Confirm that Cloudflare Access
   challenges both requests and that no Webdrop page or response body is returned.
   Also send an unauthenticated `POST` to the exact control `/publish` path without
   a body or stored cookies. Record only its status, not response headers or body:

   ```sh
   curl --silent --show-error --output /dev/null \
     --write-out '%{http_code}\n' \
     --header "Origin: https://<CONTROL_HOSTNAME>" \
     --request POST "https://<CONTROL_HOSTNAME>/publish"
   ```

   The status must be the expected Access challenge or denial for the configured
   login flow. A Worker-generated `400` means the request bypassed Access and is
   a failure.
5. Check the Worker custom domains and routes. Confirm that only the two approved
   hostnames exist and that no `workers.dev`, preview URL, wildcard, or extra
   route reaches the Worker.
6. Check the R2 bucket. Confirm the metadata and content prefix exist, but record
   only key names/counts and timestamps, never object bodies.
7. After the recorded expiry, open the same pages URL and confirm a 404. This is
   the read-time boundary.
8. After a scheduled 03:00 UTC cleanup has run, confirm that both the metadata key
   and site prefix are absent. Waiting for the configured trigger is required;
   a local scheduled-handler invocation does not prove live Cron delivery.

## Rollback

Worker rollback does not roll back R2 contents, Access applications, custom
domains, or Cron configuration. The rollback command does not delete R2 objects,
but the existing Cron Trigger continues to reclaim expired objects normally. If
the rollback requires a forensic freeze, separately disable the Cron Trigger
after explicit approval before rolling back; preserving the bucket alone is not
a data snapshot.

1. Identify the previous version recorded before deployment and reconfirm the
   Worker name with the operator.
2. Roll back the Worker only after explicit approval:

   ```sh
   pnpm exec wrangler rollback <PREVIOUS_VERSION_ID> \
     --config ops/cloudflare/wrangler.limited.jsonc
   ```

3. If the limited environment must be withdrawn, remove the two Worker custom
   domains after explicit approval and verify that neither hostname reaches the
   Worker. Only then disable the corresponding Access applications. Disabling
   Access while a Worker route is still active would create a public bypass.
   Do not delete the R2 bucket as part of rollback; preserve it for inspection
   unless the operator separately authorizes data deletion.
4. Re-run the unauthenticated checks and record what was actually observed.

## What this acceptance does not prove

- Access JWT signature validation inside the Worker.
- CLI, CI, service-token, or public-user flows.
- Production availability, alerting, or cleanup timeliness guarantees.
- Site-to-site isolation on the shared pages origin.
- Live Cron delivery or physical deletion until the scheduled run is observed.
- Absence of private data unless the chosen fixture was independently reviewed.
