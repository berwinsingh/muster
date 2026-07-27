import React from 'react';
import { C } from '../theme';
import { mono } from '../fonts';

/**
 * A terminal window. Deliberately plainer than a real one — no tab strip,
 * no OS chrome — so the eye goes to the output rather than to which editor
 * this was shot in.
 */
export const Terminal: React.FC<{
  title?: string;
  width?: number;
  height?: number;
  children: React.ReactNode;
  /** 0–1: window scales and fades in. */
  reveal?: number;
  fontSize?: number;
}> = ({ title = 'muster', width = 1360, height = 720, children, reveal = 1, fontSize = 22 }) => {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 18,
        background: C.bgRaise,
        border: `1px solid ${C.line}`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        // A large soft shadow reads as depth without a visible edge.
        boxShadow: '0 60px 120px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.02)',
        transform: `scale(${0.96 + 0.04 * reveal})`,
        opacity: reveal,
      }}
    >
      <div
        style={{
          height: 46,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 18px',
          background: 'rgba(255,255,255,0.02)',
          borderBottom: `1px solid ${C.lineSoft}`,
        }}
      >
        {['#f47067', '#f2cc60', '#4ecb71'].map((dot) => (
          <div
            key={dot}
            style={{ width: 11, height: 11, borderRadius: 999, background: dot, opacity: 0.55 }}
          />
        ))}
        <span
          style={{
            fontFamily: mono,
            fontSize: 14,
            color: C.faint,
            marginLeft: 14,
          }}
        >
          {title}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          padding: '22px 26px',
          fontFamily: mono,
          fontSize,
          lineHeight: 1.55,
          color: C.text,
          overflow: 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** A block cursor that blinks on a real terminal's cadence (~530ms). */
export const Cursor: React.FC<{ frame: number; fps: number; visible?: boolean }> = ({
  frame,
  fps,
  visible = true,
}) => {
  const on = Math.floor((frame / fps) * 1000 / 530) % 2 === 0;
  return (
    <span
      style={{
        display: 'inline-block',
        width: '0.55em',
        height: '1.05em',
        background: C.amber,
        opacity: visible && on ? 1 : 0,
        verticalAlign: 'text-bottom',
        marginLeft: 2,
      }}
    />
  );
};

/** Reveal `text` a character at a time. `progress` is 0–1. */
export const typed = (text: string, progress: number): string =>
  text.slice(0, Math.round(Math.max(0, Math.min(1, progress)) * text.length));
