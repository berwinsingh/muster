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

## After the first publish

- Update the website ([docs/index.html](docs/index.html)): remove the `SOON`
  badge from the Marketplace card — the `code --install-extension muster.muster`
  command becomes real (adjust if the publisher ID changed).
- Update [README.md](README.md) with a Marketplace badge/link.
- The Marketplace listing page renders `README.md` — check it reads well there.
