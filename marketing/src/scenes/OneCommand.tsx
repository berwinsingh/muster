import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Backdrop, Statement } from '../components/Statement';
import { Bloom } from '../components/Camera';

/**
 * The turn. Opens on the point the six windows collapsed into — a bright
 * core that flares and expands, so the cut reads as one continuous move
 * rather than as two scenes that happen to be adjacent.
 */
export const OneCommand: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const core = spring({
    frame,
    fps,
    config: { damping: 18, mass: 0.5, stiffness: 120 },
    durationInFrames: 24,
  });

  // The core swells, then hands off to the words and fades.
  const coreSize = interpolate(core, [0, 1], [10, 1500]);
  const coreOpacity = interpolate(frame, [0, 6, 26], [0.95, 0.7, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <Backdrop glow={1} />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: coreSize,
            height: coreSize * 0.55,
            borderRadius: '50%',
            background:
              'radial-gradient(circle, rgba(255,200,130,0.9), rgba(255,180,84,0.25) 45%, transparent 70%)',
            opacity: coreOpacity,
            filter: 'blur(18px)',
          }}
        />
      </AbsoluteFill>

      <Bloom at={2} intensity={0.16} />

      <Statement
        size={132}
        lines={[
          [{ text: 'One' }, { text: 'command.' }],
          [{ text: 'Full' }, { text: 'stack' }, { text: 'running.', highlight: true }],
        ]}
      />
    </AbsoluteFill>
  );
};
