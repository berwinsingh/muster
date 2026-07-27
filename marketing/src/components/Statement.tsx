import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { C } from '../theme';
import { sans } from '../fonts';

/**
 * A full-screen statement. Words rise and un-blur in sequence, then the
 * whole line drifts up a little as it leaves — slow enough to read once,
 * which is the point of a claim you only get to make once.
 */
export const Statement: React.FC<{
  /** Words; a `highlight` word is drawn in amber. */
  lines: { text: string; highlight?: boolean }[][];
  /** Frame within the enclosing Sequence at which the exit begins. */
  exitAt?: number;
  size?: number;
  align?: 'center' | 'left';
  sub?: string;
}> = ({ lines, exitAt, size = 96, align = 'center', sub }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const exitFrame = exitAt ?? durationInFrames - 18;

  const exit = interpolate(frame, [exitFrame, exitFrame + 18], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  let wordIndex = 0;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: align === 'center' ? 'center' : 'flex-start',
        padding: align === 'center' ? '0 140px' : '0 160px',
        gap: 6,
        opacity: 1 - exit,
        transform: `translateY(${-26 * exit}px)`,
      }}
    >
      {lines.map((line, li) => (
        <div
          key={li}
          style={{
            display: 'flex',
            // px, not em: `em` here resolves against this container's
            // inherited 16px, not the word font-size, which silently glued
            // every word together ("Onecommand.").
            gap: size * 0.28,
            flexWrap: 'wrap',
            justifyContent: align === 'center' ? 'center' : 'flex-start',
          }}
        >
          {line.map((word, wi) => {
            const delay = wordIndex * 3;
            wordIndex += 1;
            // Underdamped on purpose: each word overshoots a little and
            // settles. Fully damped, the line arrives without ever landing.
            const enter = spring({
              frame: frame - delay,
              fps,
              config: { damping: 13, mass: 0.5, stiffness: 110 },
              durationInFrames: 30,
            });
            const appear = Math.min(1, Math.max(0, enter));
            return (
              <span
                key={wi}
                style={{
                  fontFamily: sans,
                  fontWeight: 700,
                  fontSize: size,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.12,
                  color: word.highlight ? C.amber : C.text,
                  opacity: appear,
                  transform: `translateY(${(1 - enter) * 26}px) scale(${0.86 + 0.14 * enter})`,
                  filter: `blur(${(1 - appear) * 9}px)`,
                  display: 'inline-block',
                  textShadow: word.highlight
                    ? `0 0 ${44 * appear}px rgba(255,180,84,0.35)`
                    : undefined,
                }}
              >
                {word.text}
              </span>
            );
          })}
        </div>
      ))}
      {sub ? (
        <div
          style={{
            marginTop: 26,
            fontFamily: sans,
            fontWeight: 400,
            fontSize: size * 0.26,
            color: C.muted,
            opacity: interpolate(frame, [wordIndex * 3 + 8, wordIndex * 3 + 26], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            textAlign: align,
            maxWidth: 1100,
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
};

/** Subtle vignette + grain-free gradient, so flat black doesn't band. */
export const Backdrop: React.FC<{ glow?: number }> = ({ glow = 0.5 }) => (
  <>
    <div style={{ position: 'absolute', inset: 0, background: C.bg }} />
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: `radial-gradient(1200px 620px at 50% 42%, rgba(255,180,84,${0.07 * glow}), transparent 70%)`,
      }}
    />
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'radial-gradient(120% 100% at 50% 50%, transparent 55%, rgba(0,0,0,0.55) 100%)',
      }}
    />
  </>
);
