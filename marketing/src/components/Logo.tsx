import React from 'react';
import { C } from '../theme';
import { mono } from '../fonts';

/**
 * The site's brand mark: three amber bars, each shorter and fainter than
 * the one above — the same shape as `.brand .mark` in docs/index.html,
 * scaled up. `reveal` (0–1) draws the bars in from the left.
 */
export const Logo: React.FC<{
  scale?: number;
  reveal?: number;
  showWordmark?: boolean;
}> = ({ scale = 1, reveal = 1, showWordmark = true }) => {
  const bars = [
    { width: 14, opacity: 1 },
    { width: 10, opacity: 0.75 },
    { width: 6, opacity: 0.5 },
  ];

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14 * scale,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 * scale }}>
        {bars.map((bar, i) => {
          // Bars draw in sequence, top first.
          const local = Math.max(0, Math.min(1, reveal * 3 - i));
          return (
            <div
              key={i}
              style={{
                width: bar.width * scale * local,
                height: 3 * scale,
                borderRadius: 2 * scale,
                background: C.amber,
                opacity: bar.opacity,
              }}
            />
          );
        })}
      </div>
      {showWordmark ? (
        <span
          style={{
            fontFamily: mono,
            fontWeight: 600,
            fontSize: 16 * scale,
            letterSpacing: 0.1 * 16 * scale,
            color: C.text,
            opacity: Math.max(0, Math.min(1, reveal * 2 - 1)),
          }}
        >
          MUSTER
        </span>
      ) : null}
    </div>
  );
};
