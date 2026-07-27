# The brag cut

A second launch video, 22s, built with [HyperFrames](https://www.npmjs.com/package/hyperframes)
by following the [`brag`](https://github.com/latent-spaces/brag) skill's workflow
(plan → storyboard → compose → gate → deliver).

It exists alongside `../` (the Remotion cut) because the two make **different
arguments**, not because one is a better-looking version of the other:

| | Remotion cut | brag cut |
|---|---|---|
| Claim | one command runs your whole stack | the usual tools start everything at once; this one waits |
| Opens on | the mess of six terminals | a real `FATAL: could not connect to server` |
| Audio | silent | music, CC BY 4.0 |
| Length | 35s | 22s |

## Rendering it

```bash
cd marketing/brag/composition
npm install
npx hyperframes check      # required gate: lint, runtime, layout, motion, contrast
npx hyperframes render --output brag.mp4 --quality high --fps 30
```

`npx hyperframes preview` opens a timeline editor if you want to move a beat by
hand. Renders are git-ignored — re-render rather than looking for the mp4 here.

## Why this cut says what it says

The angle came out of research into what developers actually complain about,
and what they'd say in the replies. The short version:

- **"One command, full stack running" is not a differentiator.** overmind,
  process-compose, mprocs, pm2 and docker-compose all claim a version of it.
  Leading with it invites *"this is just X"*, and for several values of X that
  reply would be fair.
- **The readiness gap is defensible.** `concurrently`, `npm-run-all` and `turbo`
  genuinely cannot hold one long-running process until another is ready. Vercel
  closed [turborepo#8484](https://github.com/vercel/turborepo/issues/8484) as
  "not planned" and pointed the requester at mprocs — which
  [can't do it either](https://github.com/pvolok/mprocs/issues/158). The same
  ask sits open in [overmind#70](https://github.com/DarthSim/overmind/issues/70)
  and tmuxinator#886.
- **So the video shows that failure, then fixes it**, and names the tools on
  screen. Specificity is the credibility signal for this audience.

Note that process-compose and devenv 2.0 *do* have readiness gating — the claim
on screen is scoped to the tools most people actually reach for, and is worded
that way deliberately.

## Honesty notes

Worth knowing before this goes out:

- **The text is real. The terminal is not a recording.** Every line on screen
  came from runs actually performed against this repo's CLI —
  `waiting for ready pattern on db…`, `ready pattern matched on db`,
  `2/2 services running`. But it is rendered as styled HTML, not captured video.
- **One deliberate substitution:** the real run used port `45000`, because a real
  Postgres already held `5432` on the machine it was recorded on. The video shows
  `5432`, since that is what a viewer's own stack would show.
- **`npx hyperframes check` passed on a broken cut.** All five audits reported
  zero errors while the payoff lines were being rendered outside the terminal box
  and were invisible — hidden act-1 lines were still occupying layout. It was
  caught by rendering a snapshot and looking at it. Treat the gate as necessary,
  not sufficient.

## What's here

| Path | What it is |
|---|---|
| `brag-plan.md` | The plan doc brag's step 2 asks for — angle, hook, tone, audio direction |
| `share-copy.txt` | Post copy to go with the video |
| `composition/index.html` | The whole video: one paused GSAP timeline, three acts plus an outro |
| `composition/assets/music/` | The track and its licence record |

The composition is a single HTML file on purpose — at this length, splitting it
into sub-compositions costs more in wiring than it saves in clarity.
