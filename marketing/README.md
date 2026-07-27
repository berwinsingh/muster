# Muster marketing video

The launch video, built with [Remotion](https://www.remotion.dev/) — React
components rendered to frames, so the whole thing is diffable text rather
than a binary project file.

Standalone: its own `package.json`, not part of the extension build. Root
`npm ci` / `npm test` / `npm run package` never touch it, and `marketing/**`
is in `.vscodeignore` so it can't end up inside the VSIX.

## Running it

```bash
cd marketing
npm install
npm start          # Remotion Studio — scrub, tweak, hot reload
npm run render     # → out/muster-launch.mp4 (1920x1080, 36s)
```

`out/` is git-ignored, so renders don't get committed. Re-render rather than
looking for the file in the repo.

Other outputs:

```bash
npm run render:square   # 1080x1080 for feeds that reward height
npm run still           # a poster frame
npx remotion still Launch out/f500.png --frame=500   # any single frame
```

## How it's put together

| Path | What it is |
|---|---|
| `src/theme.ts` | Palette and the scene timeline. **Edit timings here**, not in scenes |
| `src/fonts.ts` | Space Grotesk + JetBrains Mono, bundled rather than fetched |
| `src/Launch.tsx` | Stitches the scenes together, handles the cross-fades |
| `src/scenes/` | One file per beat |
| `src/components/` | Terminal window, dashboard, kinetic type, logo |

The palette in `theme.ts` is copied from `docs/index.html`. If the site's
colours change, change them here too — nothing enforces that automatically.

## The one rule

**Everything shown is real.** The dashboard, the status glyphs (`●` / `◐`),
the footer keys, the log view's `1–18 of 184`, the edit form, the MCP tool
names — all match what the product actually does, because a launch video
that overstates gets found out on the first `muster` someone runs.

If a feature changes, the video is wrong until it's updated. In particular:

- `src/components/Dashboard.tsx` mirrors `src/cli/render.ts`
- the MCP tool list in `src/scenes/Agents.tsx` mirrors `src/mcp/`
- the end card points at GitHub deliberately: the Marketplace listing and
  `npm i -g muster-cli` were not live when this was made

## Timing

Scene boundaries live in `SCENES` in `src/theme.ts`, in frames at 30fps.
Changing one duration shifts everything after it, which is the point — the
`from` values are absolute so a scene can't silently overlap its neighbour.
