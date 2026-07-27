import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { C, SCENES } from './theme';
import { Problem } from './scenes/Problem';
import { OneCommand } from './scenes/OneCommand';
import { Boot } from './scenes/Boot';
import { Logs } from './scenes/Logs';
import { Edit } from './scenes/Edit';
import { Agents } from './scenes/Agents';
import { Close } from './scenes/Close';

const FADE = 12;

/**
 * Scenes cut on a short cross-fade rather than hard — at this pace a hard
 * cut between two dark frames reads as a dropped frame. Each scene owns its
 * own internal motion; this only handles the seams.
 */
const Scene: React.FC<{
  from: number;
  duration: number;
  children: React.ReactNode;
}> = ({ from, duration, children }) => {
  const frame = useCurrentFrame();
  const local = frame - from;
  const opacity = interpolate(
    local,
    [-1, 0, FADE, duration - FADE, duration],
    [0, 0.15, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );
  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
    </Sequence>
  );
};

export const Launch: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Scene {...SCENES.problem}>
      <Problem />
    </Scene>
    <Scene {...SCENES.oneCommand}>
      <OneCommand />
    </Scene>
    <Scene {...SCENES.boot}>
      <Boot />
    </Scene>
    <Scene {...SCENES.logs}>
      <Logs />
    </Scene>
    <Scene {...SCENES.edit}>
      <Edit />
    </Scene>
    <Scene {...SCENES.agents}>
      <Agents />
    </Scene>
    <Scene {...SCENES.close}>
      <Close />
    </Scene>
  </AbsoluteFill>
);
