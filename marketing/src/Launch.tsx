import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { C, SCENES } from './theme';
import { Drift } from './components/Camera';
import { Problem } from './scenes/Problem';
import { OneCommand } from './scenes/OneCommand';
import { Boot } from './scenes/Boot';
import { Logs } from './scenes/Logs';
import { Edit } from './scenes/Edit';
import { Agents } from './scenes/Agents';
import { Close } from './scenes/Close';

/**
 * Scene seams. Not every cut wants the same treatment — a uniform
 * cross-dissolve everywhere is what makes a reel feel like a slideshow.
 *
 * - `cut`  : near-instant. Used where the scenes already share a shape, so
 *            the motion carries across the join instead of the fade.
 * - `soft` : a short dissolve between two unrelated compositions.
 *
 * `scaleFrom` gives a scene a slight push on entry, so the frame is moving
 * before the eye settles.
 */
type Seam = { in: number; out: number; scaleFrom?: number };

const CUT: Seam = { in: 2, out: 6 };
const SOFT: Seam = { in: 10, out: 10 };

const Scene: React.FC<{
  from: number;
  duration: number;
  seam?: Seam;
  drift?: number;
  children: React.ReactNode;
}> = ({ from, duration, seam = SOFT, drift = 1, children }) => {
  const frame = useCurrentFrame();
  const local = frame - from;

  const opacity = interpolate(
    local,
    [-1, 0, seam.in, duration - seam.out, duration],
    [0, 0.2, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  const scale = seam.scaleFrom
    ? interpolate(local, [0, 26], [seam.scaleFrom, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 1;

  return (
    <Sequence from={from} durationInFrames={duration} layout="none">
      <AbsoluteFill style={{ opacity, transform: `scale(${scale})` }}>
        <Drift amount={drift} phase={from}>
          {children}
        </Drift>
      </AbsoluteFill>
    </Sequence>
  );
};

export const Launch: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Scene {...SCENES.problem} seam={{ in: 10, out: 4 }}>
      <Problem />
    </Scene>

    {/* Cut: the collapsed core is already on screen — the fade would only
        blur the handoff between the six windows and the one. */}
    <Scene {...SCENES.oneCommand} seam={CUT} drift={0.4}>
      <OneCommand />
    </Scene>

    {/* Cut again: the terminal springs open out of that same point. */}
    <Scene {...SCENES.boot} seam={CUT} drift={0.7}>
      <Boot />
    </Scene>

    <Scene {...SCENES.logs} seam={{ ...SOFT, scaleFrom: 1.05 }}>
      <Logs />
    </Scene>

    <Scene {...SCENES.edit} seam={{ ...SOFT, scaleFrom: 0.97 }}>
      <Edit />
    </Scene>

    <Scene {...SCENES.agents} seam={SOFT} drift={0.6}>
      <Agents />
    </Scene>

    <Scene {...SCENES.close} seam={{ in: 8, out: 14 }} drift={0.35}>
      <Close />
    </Scene>
  </AbsoluteFill>
);
