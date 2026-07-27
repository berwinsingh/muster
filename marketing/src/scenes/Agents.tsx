import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { mono, sans } from '../fonts';
import { Backdrop } from '../components/Statement';

/** The MCP tools the server actually exposes. */
const TOOLS = [
  'list_server_groups',
  'run_server_group',
  'get_group_status',
  'get_service_logs',
  'stop_server_group',
  'restart_server_group',
];

export const Agents: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headIn = interpolate(frame, [0, 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <Backdrop glow={0.6} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: 46,
          padding: '0 140px',
        }}
      >
        <div
          style={{
            fontFamily: sans,
            fontWeight: 700,
            fontSize: 68,
            letterSpacing: '-0.02em',
            color: C.text,
            textAlign: 'center',
            opacity: headIn,
            transform: `translateY(${(1 - headIn) * 16}px)`,
          }}
        >
          Your agent can run it too.
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            justifyContent: 'center',
            maxWidth: 1180,
          }}
        >
          {TOOLS.map((tool, i) => {
            const enter = spring({
              frame: frame - 16 - i * 4,
              fps,
              config: { damping: 200, mass: 0.6 },
              durationInFrames: 20,
            });
            return (
              <div
                key={tool}
                style={{
                  fontFamily: mono,
                  fontSize: 25,
                  color: C.amber,
                  padding: '12px 22px',
                  borderRadius: 12,
                  background: 'rgba(255,180,84,0.07)',
                  border: '1px solid rgba(255,180,84,0.22)',
                  opacity: enter,
                  transform: `translateY(${(1 - enter) * 14}px)`,
                }}
              >
                {tool}
              </div>
            );
          })}
        </div>

        <div
          style={{
            fontFamily: sans,
            fontSize: 30,
            color: C.muted,
            textAlign: 'center',
            opacity: interpolate(frame, [56, 76], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          MCP tools for Claude Code, Codex and friends — with a confirmation gate,
          <br />
          so nothing starts or stops behind your back.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
