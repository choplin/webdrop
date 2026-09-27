# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Sign in with Google, keep a secure browser session, and sign out using Better
  Auth with a Cloudflare D1 database.
- Describe the Cloudflare target, authentication feature, and environment or
  dotenv secret sources in `webdrop.yaml`; authentication can be disabled for
  upload-and-view-only deployments.

## [0.1.0] - 2026-09-05

### Added

- Share either one HTML file or a directory with `index.html` at its root,
  straight from your browser.
- Choose an expiry of 1 hour, 24 hours, or 7 days and open the resulting site
  from its shareable URL.
- Deploy your own Webdrop instance once with `npx @choplin/webdrop deploy`.

[unreleased]: https://github.com/choplin/webdrop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/choplin/webdrop/releases/tag/v0.1.0
