# Brag Plan: Muster

## What is this app?
Muster runs a project's whole local stack from one command — ordering services by
dependency, waiting for each to actually be *ready* before starting the next, and
keeping every service's logs in one place. VS Code extension, standalone CLI, or
background daemon, all off one config file.

## The angle
Not "one command runs everything" — every process runner claims that, and a
developer audience will name five alternatives in the replies. The angle is the
one thing the popular tools genuinely cannot do: **wait**. `concurrently`,
`npm-run-all` and `turbo` start every process at the same instant, so an API that
needs its database comes up first and dies. That failure is instantly recognisable
to anyone who has run a stack locally, and it is provable on camera.

Vercel closed the request for this in Turborepo (#8484) as "not planned". The
equivalent asks are open and unanswered in mprocs (#158), overmind (#70) and
tmuxinator (#886). So the claim is defensible, not marketing.

## Hook (first 2-3 seconds)
Real captured terminal output, mid-failure, no title card:

    FATAL:  could not connect to server: Connection refused

…and then, one beat later, the line that makes every developer wince:

    database system is ready to accept connections

The database came up. Just too late. No narration needed — the joke is in the
ordering, and it is real output from a real run.

## Key moments (the middle)
- The two log lines landing in the wrong order — the whole problem in 4 seconds.
- The named alternatives, stated flatly: these start everything at once. Not a
  cheap shot; it is what they do, and their maintainers have said so.
- `waiting for ready pattern on db…` — Muster visibly *pausing*. This is the
  product's actual differentiator and the frame the video exists to show.
- `ready pattern matched on db` → the API starts → `Application startup complete.`

## Outro / punchline
The same stack, the same two services, the right order. `2/2 services running`.
Then the wordmark and the repo. No install command — the npm package is not
published yet and a dead command on screen would break trust on the first thing
someone tries.

## User flow worth showing
1. Developer runs `muster up docq`.
2. Muster starts the database and holds the API back.
3. Ready pattern matches; the API starts and connects.
This is the entire flow and it is 12 seconds of real terminal output.

## Tone
- Preset: `polished`
- Creative direction: restraint as the credibility signal — this audience distrusts polish applied to unproven claims
- Interpretation: slow reveals, no jokes, no motion for its own sake. Every frame on screen is real captured output. The video's job is to be believed, not admired.

## Format: landscape — 1920x1080
## Duration: 22s

## Visual identity (from the project)
- Background: `#0b0d10`
- Accent: `#ffb454`
- Text: `#e8eaed`
- Muted: `#9aa3ad`
- Display font: Space Grotesk
- Body font: JetBrains Mono
- Strongest visual element: the terminal itself — amber `[muster]` narrator lines against per-service coloured prefixes

## Share copy (draft)
Your API starts before your database is up. `concurrently` can't fix that — it
starts everything at once. Muster waits for a ready signal, then starts what
depends on it. One config, one command, works with or without VS Code.

## Audio direction
- Role: sparse professional accents
- Music: `happy-beats-business-moves-vol-10` (bundled), 109.96 BPM
- Music treatment: enter at 0s low (0.35), duck under the failure beat, lift on the resolution, fade out under the outro
- Music cue guidance: strong cues at 15.82s, 18.01s, 18.55s — land the "2/2 running" resolution and the wordmark on those. Beat grid ~0.55s apart for sequential log lines.
- Audio-reactive treatment: none — deadpan restraint; the terminal should not throb
- SFX posture: none. Real terminal output does not go "whoosh"
- Audio-coupled moments: the ready-pattern match, the wordmark reveal
- Restraint rule: music must never imply excitement the output doesn't earn. If it sounds like an ad, it has failed.
