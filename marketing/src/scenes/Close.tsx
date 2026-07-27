import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { mono, sans } from '../fonts';
import { Backdrop } from '../components/Statement';
import { Bloom } from '../components/Camera';
import { Logo } from '../components/Logo';

export const Close: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Lands with a little overshoot — the last thing on screen should arrive,
  // not drift in.
  const logoIn = spring({
    frame,
    fps,
    config: { damping: 14, mass: 0.6, stiffness: 120 },
    durationInFrames: 32,
  });

  const lineIn = interpolate(frame, [22, 44], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const urlIn = interpolate(frame, [44, 64], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <Backdrop glow={1} />
      <Bloom at={6} intensity={0.1} />
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          gap: 40,
        }}
      >
        <div style={{ transform: `scale(${0.94 + 0.06 * logoIn})`, opacity: logoIn }}>
          <Logo scale={4.6} reveal={logoIn} />
        </div>

        <div
          style={{
            fontFamily: sans,
            fontWeight: 700,
            fontSize: 62,
            letterSpacing: '-0.02em',
            color: C.text,
            textAlign: 'center',
            opacity: lineIn,
            transform: `translateY(${(1 - lineIn) * 14}px)`,
          }}
        >
          One command. <span style={{ color: C.amber }}>Full stack running.</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            fontFamily: mono,
            fontSize: 30,
            color: C.muted,
            opacity: urlIn,
            transform: `translateY(${(1 - urlIn) * 10}px)`,
            padding: '14px 28px',
            borderRadius: 14,
            background: 'rgba(255,255,255,0.04)',
            border: `1px solid ${C.line}`,
          }}
        >
          <span>
            github.com/berwinsingh/<span style={{ color: C.amber }}>muster</span>
          </span>
        </div>

        <div
          style={{
            fontFamily: sans,
            fontSize: 24,
            color: C.faint,
            opacity: urlIn * 0.9,
          }}
        >
          VS Code · Cursor · or no editor at all · MIT
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
