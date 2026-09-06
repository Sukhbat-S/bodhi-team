# BODHI — team distribution

BODHI is a local, single-user personal truth and control substrate. It stores an owner’s memories, entities, decisions and verification evidence. Codex owns reasoning, tools, tasks, scheduling and delegation.

This repository distributes reusable source and skills. It contains no owner database, personal records, credentials or original private Git history. Each teammate runs a separate instance with their own data and permissions. This is not a shared multi-user server.

## Status

Version 1.1.0-preview.1 is a private preview for technical teammates. Source builds and automated checks are documented in the release notes; a clean-machine installation and every external connector are not yet certified. Initial installation support is macOS (Apple Silicon and Intel), with Node 24, npm 11, Homebrew PostgreSQL 18 and pgvector. Windows installation is not covered by this preview.

## First installation

1. Download the versioned source package and SHA256SUMS from this repository’s Releases page. Compare its checksum with the release notes before executing it.
2. Extract it to a new directory outside an existing BODHI installation. The release package includes a pinned `.release/manifest.json`; a raw GitHub source ZIP does not.
3. Install the prerequisites above. Review the scripts before running them. Each person needs their own local PostgreSQL account/database and, for semantic embeddings, their own Voyage API access. Do not reuse another owner’s configuration.
4. From the extracted package, run a dry preflight:

```bash
bash scripts/bootstrap-personal-macos.sh --owner "Your name" --assistant "BODHI" --database bodhi_personal --port 4000 --expected-manifest-sha256 MANIFEST_HASH_FROM_RELEASE
```

5. After reviewing the preflight, append `--apply --defer-voyage` to create a fresh local installation without entering a provider key. This creates local private configuration/database state and may register the local service as described by the script. It refuses an existing database, environment file or owner instructions.
6. Add your own Voyage configuration locally, then follow `scripts/activate-personal-voyage-macos.sh --help` usage. Never commit the key. The server stays on loopback by default.
7. Review and install the project-local skills:

```bash
npm run skills:install
npm run skills:install -- --apply
```

The optional Codex MCP adapter is under `integrations/codex-plugin/bodhi`. Point it at your own local environment and API only. Connector authentication and permissions remain owner-specific.

## Following updates

Watch Releases in GitHub. Each release has a changelog, exact source commit, package checksum and manifest hash. Use the packaged release rather than pulling source into an active installation with private state. Review `scripts/upgrade-personal-macos.sh` usage and run its preflight against the new package. Keep backups and follow its manifest, compatibility and migration checks; do not copy `.env`, databases or tokens between owners.

For source contributors: clone this repository, use Node 24/npm 11, run `npm ci`, `npm test`, and `npm run build`. Changes are not released merely because they are pushed. Run `npm run check:privacy` before publication. To pack committed, reviewed source, run `npm run pack:release -- --output NEW_DIRECTORY`.

## Included skills

The owner-neutral templates cover session continuity, verification, research and visual review, plus workflow discovery, existing-system adoption, operational debugging, component-driven UI and skill behavior evaluation. Static validation and practical trials are not broad behavioral certification. A template’s presence does not prove an external tool is connected.

## Privacy and support

Never upload your `.env`, database, memory exports, backups, tokens or raw private logs when requesting support. Share a minimal sanitized reproduction. The original private development repository is not part of this history. The upstream MIT copyright notice is retained as required attribution.

See [SECURITY.md](SECURITY.md) and [CHANGELOG.md](CHANGELOG.md).
