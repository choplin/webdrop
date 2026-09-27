<p align="center">
  <img src="client/logo.png" width="96" alt="Webdrop logo">
</p>

# Webdrop

> Drop and share your HTML.

Turn a local HTML file or static site into a temporary, shareable URL. Drop it
into Webdrop, choose when it expires, and send the link.

**Drop a file or folder → Choose an expiry → Share the URL**

## Why Webdrop?

- **Go from local to live.** Publish finished HTML without setting up a
  repository, project, or deployment pipeline.
- **Share without leaving a permanent site behind.** Links expire after 1 hour,
  24 hours, or 7 days, and Webdrop cleans up the files.
- **Run it in your own Cloudflare account.** Your Worker, storage, and hostnames
  stay under your control.

## Deploy Webdrop

Create `webdrop.yaml` to describe the deployment. Replace the hostname with one
in a Cloudflare DNS zone you own:

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

Then deploy with one command:

```sh
npx @choplin/webdrop deploy
```

Wrangler asks you to sign in to Cloudflare when needed. When the deployment
finishes, the command prints the URL for your Webdrop app. No repository copy
or continuous deployment setup is required.

By default, Wrangler checks for pending D1 migrations after deployment and asks
before applying them. Pass `--apply-migrations` to apply pending migrations
without confirmation, such as from CI or another non-interactive shell.

To deploy only upload and viewing, disable authentication and omit `secrets`:

```yaml
version: 1
target:
  provider: cloudflare
  hostname: webdrop.example.com
features:
  authentication: disabled
```

This configuration does not provision D1, require OAuth secrets, expose auth
API routes, or show login controls.

### What you need

- Node.js 22 or later
- A Cloudflare account
- An active Cloudflare DNS zone that you own
- Two available hostnames: `webdrop.example.com` and
  `sites.webdrop.example.com`
- A Google OAuth web client with this authorized redirect URI:
  `https://webdrop.example.com/api/auth/callback/google`

Create the referenced, ignored `.dev.vars` file before development or deployment.
Use a fresh random value of at least 32 characters for `BETTER_AUTH_SECRET`:

```dotenv
BETTER_AUTH_SECRET=replace-me
GOOGLE_CLIENT_ID=replace-with-google-oauth-client-id
GOOGLE_CLIENT_SECRET=replace-with-google-oauth-client-secret
```

### What gets deployed

The command creates or updates:

- a Webdrop Worker;
- an R2 bucket for published sites;
- a D1 database for users and sessions;
- a Custom Domain for `webdrop.example.com`; and
- a Custom Domain for `sites.webdrop.example.com`.

Cloudflare credentials remain in Wrangler's local configuration; Webdrop does
not store them.

To validate the package and generated configuration without changing your
Cloudflare account, run a dry deployment:

```sh
npx @choplin/webdrop deploy --dry-run
```

## Publish your HTML

Open your Webdrop app, then:

1. Drop an HTML file or a folder onto the upload card.
2. Choose an expiry: 1 hour, 24 hours, or 7 days.
3. Select **Publish**.
4. Open the shareable URL.

A single HTML file becomes the site's `index.html`. A folder must contain
`index.html` at its root; Webdrop preserves nested paths for supported assets.
It serves HTML, CSS, JavaScript, JSON, WebAssembly, web manifests, XML, text,
PDFs, common web images, and WOFF/WOFF2 fonts.

### Upload limits

| Limit | Maximum |
| --- | ---: |
| Files | 100 |
| Size of one file | 10 MiB |
| Total upload size | 50 MiB |

## Keep Webdrop private

Webdrop makes the app and published sites public by default. The simplest way
to restrict both is to put them behind one Cloudflare Access application:

1. In the Cloudflare dashboard, go to **Zero Trust > Integrations > Identity
   providers**, add **One-time PIN**, and enable it.
2. Go to **Access controls > Applications** and create a **Self-hosted and
   private** application.
3. Add `webdrop.example.com` and `sites.webdrop.example.com` as public
   hostnames, replacing `webdrop.example.com` with your Webdrop hostname.
4. Select **One-time PIN** as the application's identity provider, then add an
   **Allow** policy that includes only the email addresses that should have
   access.
5. Create the application, then open both hostnames in a private browser window
   and confirm that Cloudflare asks you to sign in and emails an access code.

Protect both hostnames to keep uploads and shared links private. Protecting only
the app hostname restricts publishing, but leaves published sites public. See
Cloudflare's [self-hosted application guide](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)
for additional policy and identity-provider options.

## Deploy from source

Use this path to inspect or modify Webdrop before deployment. It requires Nix
with flakes enabled in addition to the Cloudflare prerequisites above.

```sh
nix develop
pnpm install --frozen-lockfile
pnpm exec wrangler login
cp webdrop.example.yaml webdrop.yaml
pnpm run deploy
```

Preview the generated deployment without changing Cloudflare:

```sh
pnpm run deploy -- --dry-run
```

## Develop locally

Set up the repository:

```sh
nix develop
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
pnpm run auth:migrate:local
```

Fill in `.dev.vars` with a Better Auth secret and Google OAuth credentials. For
local Google login, add
`https://localhost:8787/api/auth/callback/google` to the OAuth client's
authorized redirect URIs. The file is ignored by Git.

Start Webdrop and open `https://localhost:8787`:

```sh
pnpm dev
```

Your local published sites use `https://sites.localhost:8787`. You may need to
accept the local development certificate in your browser.

Build and preview the production output:

```sh
pnpm build
pnpm preview
```

Run the checks used by CI:

```sh
pnpm run ci
```

## License

Webdrop is available under the [MIT License](LICENSE).
