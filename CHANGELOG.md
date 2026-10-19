# Changelog

## [1.0.2] - 2026-10-19

### Added

- `SQL_INSPECTOR_TTL_MINUTES` (default `60`, `0` disables): requests with no new query for that long are dropped from memory, on top of the existing request and query caps.

### Changed

- Republished from the current repository history so the npm provenance points to an existing source commit.

## [1.0.1] - 2026-10-19

### Changed

- CI: publish to npm automatically through trusted publishing (OIDC) when a GitHub Release is published. Provenance is attached automatically.

## [1.0.0] - 2026-10-19

### Added

- Initial release.
