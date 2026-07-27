import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';

/**
 * A slow continuous drift applied under every scene. Nothing in the frame
 * is ever perfectly still, which is most of the difference between "a
 * rendered slide" and "a shot" — it reads as a locked-off camera with a
 * little life in it rather than as a PNG.
 */
export const Drift: React.FC<{
  children: React.ReactNode;
  /** Multiplies the movement; 0 disables it for a scene that needs to sit still. */
  amount?: number;
  /** Offsets the phase so consecutive scenes don't drift in lockstep. */
  phase?: number;
}> = ({ children, amount = 1, phase = 0 }) => {
  const frame = useCurrentFrame();
  const t = (frame + phase) / 30;
  const x = Math.sin(t * 0.34) * 7 * amount;
  const y = Math.cos(t * 0.27) * 5 * amount;
  const scale = 1 + Math.sin(t * 0.2) * 0.004 * amount;

  return (
    <AbsoluteFill style={{ transform: `translate(${x}px, ${y}px) scale(${scale})` }}>
      {children}
    </AbsoluteFill>
  );
};

/**
 * A one-off punch: a fast scale-up that settles, for the frame where
 * something lands. Deliberately short — held too long it reads as a zoom
 * rather than an accent.
 */
export const punch = (frame: number, at: number, strength = 0.03): number => {
  if (frame < at) return 1;
  return (
    1 +
    strength *
      interpolate(frame, [at, at + 4, at + 20], [0, 1, 0], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
  );
};

/** A white bloom that flares and dies, for a moment worth marking. */
export const Bloom: React.FC<{ at: number; intensity?: number }> = ({ at, intensity = 0.1 }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [at, at + 3, at + 22], [0, intensity, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (opacity <= 0) return null;
  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(900px 520px at 50% 50%, rgba(255,200,130,1), transparent 70%)',
        opacity,
        mixBlendMode: 'screen',
        pointerEvents: 'none',
      }}
    />
  );
};
