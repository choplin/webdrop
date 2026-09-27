# @choplin/webdrop

Deploy a self-hosted Webdrop instance to your Cloudflare account without
creating a Git repository or configuring continuous deployment.

Create `webdrop.yaml` with the deployment target, enabled features, and secret
sources:

```yaml
version: 1
target:
  provider: cloudflare
  hostname: webdrop.example.com
features:
  authentication:
    provider: google
secrets:
  BETTER_AUTH_SECRET:
    source: dotenv
    path: .dev.vars
    name: BETTER_AUTH_SECRET
  GOOGLE_CLIENT_ID:
    source: dotenv
    path: .dev.vars
    name: GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET:
    source: dotenv
    path: .dev.vars
    name: GOOGLE_CLIENT_SECRET
```

Then run:

```sh
npx @choplin/webdrop deploy
```

The command also configures `sites.webdrop.example.com` for published sites.
Both hostnames must be available in an active Cloudflare DNS zone you own.

The command authenticates through Wrangler and creates the Worker, its `SITES`
R2 bucket, its `AUTH_DB` D1 database, and public Worker Custom Domains for the
application and published sites. Cloudflare credentials remain in Wrangler's
local configuration and are not stored by Webdrop. It does not create a Git
repository or configure continuous deployment.

The ignored `.dev.vars` file must contain `BETTER_AUTH_SECRET`,
`GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET`. Generate a unique Better Auth
secret with at least 32 characters, keep the file out of version control, and
configure `https://webdrop.example.com/api/auth/callback/google` as the Google
OAuth client's authorized redirect URI.

Without `--apply-migrations`, an interactive deployment asks before applying
pending D1 migrations. Non-interactive deployments must pass the option so a
missing prompt cannot leave the authentication schema unapplied.

Set `features.authentication` to `disabled` and omit `secrets` to deploy only
upload and viewing. That configuration does not provision D1 or expose the auth
UI and API routes.

Validate the packaged deployment locally without changing Cloudflare:

```sh
npx @choplin/webdrop deploy --dry-run
```
