# Webdrop

## Browser check

Build the local browser assets, then run the Worker with local bindings. The
`*.localhost` hostnames resolve to the local machine and share Wrangler's port,
so the control plane can link to the local pages plane:

```sh
pnpm build:assets
pnpm dev
```

Open `https://control.localhost:8787` (accept Wrangler's local development
certificate). Select a directory containing a root `index.html`, publish it,
and follow the returned link. The file picker uses the browser's
directory-selection support (`webkitdirectory`).
