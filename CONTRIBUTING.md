# Contributing to Muster

Thanks for taking the time. Muster is a small project, so the process is
light — but `main` is protected and CI is the gate, so a few things are
worth knowing before you open a PR.

## Getting set up

```bash
git clone https://github.com/berwinsingh/muster.git
cd muster
npm install
npm run compile
```

Then put `muster` on your PATH so you're running your build, not an
installed copy:

```bash
npm link
muster --version    # should print a path inside your checkout
```

That last check matters. `dist/` is git-ignored, so `git pull` updates the
source and leaves the compiled CLI untouched — you can spend an afternoon
debugging something you already fixed. The launcher warns when the build is
older than `src/`, but `--version` is the direct answer to "which copy am I
actually running".

## Before you open a PR

```bash
npm run lint     # tsc --noEmit
npm test         # unit tests
npm run compile  # esbuild bundles
```

All three run in CI as the `verify` job, and `verify` must pass before
anything can merge. Running them locally first saves a round trip.

The integration suite (`npm run test:integration`) drives a real VS Code
Extension Host and needs a display — it will crash on a headless machine.
CI runs it under `xvfb`. If you're working on the extension UI and can't
run it locally, say so in the PR and note what you checked by hand instead;
that's a normal and acceptable answer.

## How the code is laid out

Muster runs the same groups from three places, and the boundaries matter:

| Path | What lives there |
|------|------------------|
| `src/cli/` | The `muster` CLI, the TUI dashboard, and the headless supervisor |
| `src/daemon/` | The background daemon — serves the same HTTP API as the extension |
| `src/orchestration/` | The VS Code extension's process/terminal management |
| `src/mcp/` | MCP server and tools for AI agents |
| `src/config/` | Schema, mutations, and detection shared by all of the above |
| `src/logs/` | On-disk log persistence and retention |

**`src/cli/`, `src/daemon/`, `src/mcp/` and `src/config/` must not import
`vscode`.** They run with no editor open. If you need something from a
shared module, make the module take a plain value (a path, a string) and
let the extension adapt — not the other way round. `npm run lint` won't
catch this; the bundle will simply fail at runtime for CLI users.

The daemon and the extension deliberately serve the **same HTTP API**, so
`IpcClient` and every MCP tool work against either one unchanged. If you
add a route to one, add it to the other.

## Pull requests

- **Branch off `main`**, and keep one logical change per PR.
- **Explain the *why*.** What was broken, what the user actually saw. The
  diff already shows what changed.
- **Cover behaviour with a test** where you reasonably can. Bug fixes are
  much easier to accept with a test that fails without the fix.
- **Say what you verified and what you didn't.** "Tested the CLI path, could
  not test the VS Code path headlessly" is genuinely useful. Claiming
  everything works when you didn't check is not.

PRs are squash-merged, so your branch's commit history doesn't need to be
tidy — the PR title becomes the commit subject, so make that good.

## Filing issues

Issues are for bugs — something that should work and doesn't. Use the
templates. For a bug, the two things that actually speed up a fix are
**what you ran** and **what you saw** — the exact command, and the output
pasted as text rather than described.

If it involves a service that wouldn't start, `muster logs <group>` and
your `.vscode/muster.json` (with any secrets removed) are usually enough to
diagnose it.

For anything that isn't a bug — a question, a config you can't quite get
working, or something you built with Muster — use
[Discussions](https://github.com/berwinsingh/muster/discussions) instead:
[Q&A](https://github.com/berwinsingh/muster/discussions/categories/q-a) or
[Show and tell](https://github.com/berwinsingh/muster/discussions/categories/show-and-tell).
It keeps the issue tracker to things that need a code change.

## Security

Please don't open a public issue for a security problem — see
[SECURITY.md](SECURITY.md).
