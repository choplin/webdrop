# @choplin/webdrop

Deploy a self-hosted Webdrop instance to your Cloudflare account without
creating a Git repository or configuring continuous deployment.

```sh
npx @choplin/webdrop deploy --domain webdrop.example.com
```

The command also configures `sites.webdrop.example.com` for published sites.
Both hostnames must be available in an active Cloudflare DNS zone you own.

The command authenticates through Wrangler and creates the Worker, its `SITES`
R2 bucket, and public Worker Custom Domains for the application and published
sites. Cloudflare credentials remain in Wrangler's local configuration and are
not stored by Webdrop. It does not create a Git repository or configure
continuous deployment.

Validate the packaged deployment locally without changing Cloudflare:

```sh
npx @choplin/webdrop deploy --domain webdrop.example.com --dry-run
```
