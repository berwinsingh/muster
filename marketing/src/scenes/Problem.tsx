import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { mono, sans } from '../fonts';
import { Backdrop } from '../components/Statement';

/**
 * The before. Real commands from an ordinary stack, stacking up one window
 * at a time until the screen is as cluttered as the morning is — then the
 * line that names it.
 */
const WINDOWS = [
  { cmd: 'docker compose up -d db', dir: '~/app', x: -430, y: -210, delay: 0 },
  { cmd: 'source venv/bin/activate && uvicorn main:app --reload', dir: '~/app/api', x: 60, y: -150, delay: 9 },
  { cmd: 'pnpm dev', dir: '~/app/web', x: -330, y: 30, delay: 18 },
  { cmd: 'celery -A app worker', dir: '~/app/api', x: 180, y: 110, delay: 27 },
  { cmd: 'node mcp-server.js', dir: '~/app/agent', x: -180, y: 250, delay: 36 },
  { cmd: 'ngrok http 3000', dir: '~', x: 320, y: 300, delay: 45 },
];

export const Problem: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Everything drifts back and dims as the statement takes over.
  const recede = interpolate(frame, [78, 108], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <Backdrop glow={0.25} />

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          transform: `scale(${1 - 0.06 * recede})`,
          opacity: 1 - 0.72 * recede,
          filter: `blur(${5 * recede}px)`,
        }}
      >
        {WINDOWS.map((w, i) => {
          const enter = spring({
            frame: frame - w.delay,
            fps,
            config: { damping: 200, mass: 0.6 },
            durationInFrames: 22,
          });
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                transform: `translate(${w.x}px, ${w.y}px) scale(${0.9 + 0.1 * enter})`,
                opacity: enter * 0.96,
                width: 640,
                borderRadius: 12,
                background: C.bgRaise,
                border: `1px solid ${C.line}`,
                boxShadow: '0 26px 60px rgba(0,0,0,0.5)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '0 12px',
                  background: 'rgba(255,255,255,0.025)',
                  borderBottom: `1px solid ${C.lineSoft}`,
                }}
              >
                {['#f47067', '#f2cc60', '#4ecb71'].map((d) => (
                  <div
                    key={d}
                    style={{ width: 8, height: 8, borderRadius: 999, background: d, opacity: 0.45 }}
                  />
                ))}
                <span style={{ fontFamily: mono, fontSize: 11, color: C.faint, marginLeft: 8 }}>
                  {w.dir}
                </span>
              </div>
              <div
                style={{
                  padding: '14px 16px',
                  fontFamily: mono,
                  fontSize: 15,
                  color: C.muted,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                }}
              >
                <span style={{ color: C.green }}>$ </span>
                {w.cmd}
              </div>
            </div>
          );
        })}
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontFamily: sans,
            fontWeight: 700,
            fontSize: 78,
            letterSpacing: '-0.02em',
            color: C.text,
            textAlign: 'center',
            opacity: interpolate(frame, [84, 104], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            transform: `translateY(${interpolate(frame, [84, 104], [16, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            })}px)`,
          }}
        >
          Every morning,
          <br />
          the same six terminals.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
