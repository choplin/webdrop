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
`pages.localhost` share the development server's port, so the control plane can
link to the local pages plane:

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
