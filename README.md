# Webdrop

## Setup

Enter the Nix development shell and install the locked JavaScript dependencies:

```sh
nix develop
pnpm install --frozen-lockfile
```

The shell provides Node.js and pnpm directly. Dependency installation is an
explicit setup step; the development server does not change `node_modules`.

## Browser check

Run the Vite development server. It builds the browser assets, starts the Worker
with local bindings, and reloads changes. The control plane and
`sites.localhost` share the development server's port, so the control plane can
link to the local sites plane:

```sh
pnpm dev
```

Open `https://localhost:8787` (accept the local development
certificate). Select a directory containing a root `index.html`, publish it,
and follow the returned link. The file picker uses the browser's
directory-selection support (`webkitdirectory`).

## Production build

Build the Worker and browser assets, then preview that output locally:

```sh
pnpm build
pnpm preview
```

## Deploy to Cloudflare

Authenticate Wrangler, then pass the application hostname to the shared deploy
script:

```sh
pnpm exec wrangler login
pnpm run deploy -- --domain webdrop.example.com
```

The script validates the hostname, derives `sites.webdrop.example.com`, builds
the application, and names its Cloudflare resources after the hostname. For
example, `webdrop.example.com` creates Worker `webdrop-example-com` and R2
bucket `webdrop-example-com-sites`. It provisions the `SITES` R2 binding when
needed and deploys both hostnames as Worker Custom Domains. Use `--dry-run` to
inspect the generated deployment without changing Cloudflare:

```sh
pnpm run deploy -- --domain webdrop.example.com --dry-run
```

Deploy to Cloudflare uses the same script. Its setup form supplies `APP_DOMAIN`
instead of the `--domain` argument. Cloudflare Access is optional and is not
created by the script; the deployed hostnames are public unless the operator
adds Access protection to the Worker after deployment.
