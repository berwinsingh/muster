# Publishing Muster

How to get Muster onto the VS Code Marketplace (and Open VSX for Cursor/VSCodium users).

The manifest is already marketplace-ready: `publisher`, `icon`, `galleryBanner`,
`keywords`, `repository`, and `license` are set in [package.json](package.json), and
`npm run package` produces a valid VSIX.

## One-time setup (requires your accounts — do these yourself)

1. **Create a publisher** at <https://marketplace.visualstudio.com/manage>
   (sign in with a Microsoft account). Claim the publisher ID **`muster`** —
   if it's taken, pick another (e.g. `berwinsingh`) and update the
   `"publisher"` field in `package.json` to match.
2. **Create a Personal Access Token** in Azure DevOps
   (<https://dev.azure.com> → User settings → Personal access tokens):
   - Organization: *All accessible organizations*
   - Scope: **Marketplace → Manage**
3. Keep the token somewhere safe (it is the publishing credential — never
   commit it).

## Publish

```bash
npx vsce login <publisher-id>   # paste the PAT when prompted
npm run package                 # sanity-check the VSIX builds
npx vsce publish                # publishes the version in package.json
```

Subsequent releases: bump `"version"` in `package.json` (or use
`npx vsce publish patch|minor|major`) and run `npx vsce publish` again.

## Open VSX (Cursor, VSCodium, Windsurf)

Cursor and other VS Code forks install from Open VSX, not Microsoft's
marketplace — worth publishing to both since Muster's MCP story targets
Cursor users.

1. Create an Eclipse account at <https://open-vsx.org>, sign the publisher
   agreement, and create an access token.
2. ```bash
   npx ovsx create-namespace <publisher-id> -p <token>   # first time only
   npx ovsx publish muster-<version>.vsix -p <token>
   ```

## npm (`npm install -g muster-cli`)

The name **`muster`** is already taken on npm's registry (an unrelated
package — npm's namespace is global and separate from the Marketplace's
`publisher.name`, so this doesn't affect the extension identity at all).
**`muster-cli`** is free and is what's published — checked and reserved as
of writing.

This ships from [packages/muster-cli](packages/muster-cli), a small
package independent of the root one: its own `package.json`/name, but the
*same* compiled CLI. `scripts/build-npm-package.mjs` copies the built
`dist/cli.js` and `dist/mcp/server.js` in before every pack/publish and
syncs the version from the root `package.json` — there is exactly one
source of truth, nothing to keep in sync by hand.

1. **Create an npm account** at <https://npmjs.com/signup> if you don't
   have one, then `npm login` in a terminal.
2. Build and publish:
   ```bash
   npm run build:npm-package        # compiles + copies dist/cli.js, dist/mcp/server.js in
   cd packages/muster-cli
   npm publish                      # first publish only: add --access public
   ```

Subsequent releases: bump `"version"` in the **root** `package.json` (the
build script copies it over automatically), then repeat step 2.

**Verified before this was ever documented anywhere**: packed the tarball
with `npm pack`, installed it with `npm install -g <tarball> --prefix
<scratch dir>` (fully isolated, no registry involved), and confirmed both
`muster` and `muster-mcp` land on PATH via npm's own bin-linking with zero
extra setup — `muster help` worked immediately, and `muster ls` reached a
real running extension and returned live group data. The only thing left
before this is real for actual users is your `npm publish`.

## After the first publish

- **VS Code Marketplace**: update the website ([docs/index.html](docs/index.html))
  — remove the `SOON` badge from the Marketplace card; the
  `code --install-extension muster.muster` command becomes real (adjust if
  the publisher ID changed). Update [README.md](README.md) with a
  Marketplace badge/link. The Marketplace listing page renders `README.md`
  — check it reads well there.
- **npm**: same on the npm card — flip it live once `npm publish` succeeds.
  `npmjs.com/package/muster-cli` renders
  [packages/muster-cli/README.md](packages/muster-cli/README.md), not the
  root one — check that page too.
