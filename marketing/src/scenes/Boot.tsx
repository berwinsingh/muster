import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { mono, sans } from '../fonts';
import { Backdrop } from '../components/Statement';
import { Bloom, punch } from '../components/Camera';
import { Cursor, Terminal, typed } from '../components/Terminal';
import { Dashboard, Service, ServiceState } from '../components/Dashboard';

const SERVICES: Service[] = [
  { id: 'db', name: 'Postgres', port: 5432, command: 'docker compose up db' },
  { id: 'api', name: 'FastAPI', port: 8011, command: 'uvicorn main:app --reload --port ${port}' },
  { id: 'web', name: 'Next.js', port: 3000, command: 'pnpm dev' },
  { id: 'worker', name: 'Celery', command: 'celery -A app worker' },
  { id: 'agent', name: 'MCP Server', port: 9000, command: 'node mcp-server.js' },
];

/** Frame at which each service flips starting → running. */
const READY_AT = [92, 108, 124, 138, 150];
const START_AT = 72;

export const Boot: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // The prompt types, then the dashboard replaces it.
  const typeProgress = interpolate(frame, [8, 38], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const command = typed('muster', typeProgress);
  const submitted = frame >= 46;

  const dashReveal = interpolate(frame, [46, 62], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const states: ServiceState[] = SERVICES.map((_, i) => {
    if (frame >= READY_AT[i]) return 'running';
    if (frame >= START_AT + i * 4) return 'starting';
    return 'idle';
  });

  const rowReveal = SERVICES.map((_, i) =>
    interpolate(frame, [50 + i * 4, 64 + i * 4], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
  );

  // One decaying pulse per service, fired the frame it reports ready.
  const rowFlash = READY_AT.map((at) =>
    interpolate(frame, [at, at + 2, at + 20], [0, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
  );

  const allUp = frame >= READY_AT[READY_AT.length - 1];
  const activity = !submitted
    ? undefined
    : allUp
      ? 'docq · 5/5 services running (Ctrl+C to stop)'
      : frame >= START_AT
        ? 'starting 5 services · layout: headless · order: parallel'
        : 'preRun: docker compose up -d db';

  // The window grows out of the point the six terminals collapsed into,
  // then drifts forward for the rest of the shot.
  const open = spring({
    frame,
    fps,
    config: { damping: 20, mass: 0.6, stiffness: 110 },
    durationInFrames: 28,
  });
  const push =
    interpolate(open, [0, 1], [0.55, 1]) *
    interpolate(frame, [28, 250], [1, 1.05], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }) *
    // A beat of emphasis when the stack finishes coming up.
    punch(frame, READY_AT[READY_AT.length - 1], 0.035);

  const captionIn = interpolate(frame, [READY_AT[4] + 8, READY_AT[4] + 28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <Backdrop glow={allUp ? 0.9 : 0.4} />
      <AbsoluteFill
        style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${push})` }}
      >
        <Terminal title="zsh — ~/Documents/docq" width={1420} height={560} fontSize={21}>
          {!submitted ? (
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <span style={{ color: C.green, marginRight: 12 }}>❯</span>
              <span style={{ color: C.text }}>{command}</span>
              <Cursor frame={frame} fps={fps} />
            </div>
          ) : (
            <div style={{ height: '100%', opacity: dashReveal }}>
              <Dashboard
                workspace="~/Documents/docq"
                groupId="docq"
                groupLabel="DocQ Full Stack"
                services={SERVICES}
                states={states}
                rowReveal={rowReveal}
                rowFlash={rowFlash}
                activity={activity}
              />
            </div>
          )}
        </Terminal>
      </AbsoluteFill>

      <Bloom at={READY_AT[READY_AT.length - 1]} intensity={0.09} />

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 54,
          opacity: captionIn,
        }}
      >
        <div
          style={{
            fontFamily: sans,
            fontWeight: 600,
            fontSize: 34,
            color: C.muted,
          }}
        >
          Ports, dependencies, virtualenvs, ready-checks —{' '}
          <span style={{ color: C.amber }}>handled</span>.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
