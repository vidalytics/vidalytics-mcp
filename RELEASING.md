# Releasing

`@vidalytics/mcp` is published to npm automatically by the
[`Publish`](.github/workflows/publish.yml) workflow whenever a `v*` tag is pushed.

Authentication uses npm **Trusted Publishing** (OIDC) — there is **no npm token,
secret, or one-time password** involved. Each release is published with
[provenance](https://docs.npmjs.com/generating-provenance-statements).

## One-time setup (already done)

- The package is configured with a **Trusted Publisher** on npmjs.com:
  `@vidalytics/mcp` → org `vidalytics` → repo `vidalytics-mcp` → workflow `publish.yml`.
- The repository is **public** (required for provenance).
- No `NPM_TOKEN` secret is needed.

## Cutting a release

`main` is protected, so the version bump goes through a PR and the tag is pushed
to the merged commit.

1. **Bump the version on a branch** (`patch` | `minor` | `major`):

   ```bash
   git checkout main && git pull
   git checkout -b release/0.1.2
   npm version 0.1.2 --no-git-tag-version
   git commit -am "Release 0.1.2"
   git push -u origin release/0.1.2
   ```

   Open a PR and merge it.

2. **Tag the merged commit and push the tag:**

   ```bash
   git checkout main && git pull
   git tag v0.1.2          # the tag MUST match the version in package.json
   git push origin v0.1.2
   ```

3. **Done.** Pushing the tag triggers the `Publish` workflow, which:
   - verifies the tag matches `package.json` version,
   - runs the tests,
   - publishes to npm via OIDC with provenance.

   Watch progress in the **Actions** tab, then verify:

   ```bash
   npm view @vidalytics/mcp version
   ```

## Notes

- The tag (`vX.Y.Z`) must equal the `version` in `package.json`. The workflow
  fails fast on a mismatch.
- Published versions are immutable — npm will not let you re-publish the same
  version. Always bump.
- To target a non-production server during local testing, set
  `VIDALYTICS_MCP_URL` (must be `https://`); the published package always
  defaults to production.
