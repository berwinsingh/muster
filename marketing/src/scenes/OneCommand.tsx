import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Backdrop, Statement } from '../components/Statement';

/** The turn. The site's own line, given room to land. */
export const OneCommand: React.FC = () => (
  <AbsoluteFill>
    <Backdrop glow={1} />
    <Statement
      size={132}
      lines={[
        [{ text: 'One' }, { text: 'command.' }],
        [{ text: 'Full' }, { text: 'stack' }, { text: 'running.', highlight: true }],
      ]}
    />
  </AbsoluteFill>
);
