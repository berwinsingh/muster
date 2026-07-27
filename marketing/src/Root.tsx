import React from 'react';
import { Composition } from 'remotion';
import { FPS, TOTAL_FRAMES } from './theme';
import { Launch } from './Launch';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Launch"
      component={Launch}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
    />
    {/*
      A 1:1 cut for feeds that reward height. The scenes are centred and
      composed for 16:9, so this scales the whole frame down and letterboxes
      rather than reflowing — cropping would cut the terminal in half.
    */}
    <Composition
      id="LaunchSquare"
      component={Launch}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1080}
    />
  </>
);
