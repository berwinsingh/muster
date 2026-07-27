import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C } from '../theme';
import { mono, sans } from '../fonts';
import { Backdrop } from '../components/Statement';
import { Terminal } from '../components/Terminal';
import { KeyBar } from '../components/Dashboard';

/**
 * The log view, wrapped rather than truncated — a real traceback with
 * full-length paths, where the tail of the line is the part that matters.
 */
const LINES: { text: string; tone?: 'path' | 'code' | 'error' | 'info' }[] = [
  { text: 'INFO:     Started server process [41288]', tone: 'info' },
  { text: 'INFO:     Waiting for application startup.', tone: 'info' },
  { text: '  File "/Users/you/docq/api/venv/lib/python3.12/site-packages/', tone: 'path' },
  { text: '  sqlalchemy/orm/session.py", line 2036, in commit', tone: 'path' },
  { text: '    trans.commit(_to_root=True)', tone: 'code' },
  { text: '  File "/Users/you/docq/api/venv/lib/python3.12/site-packages/', tone: 'path' },
  { text: '  sqlalchemy/engine/base.py", line 1134, in _do_commit', tone: 'path' },
  { text: '    dbapi_connection.commit()', tone: 'code' },
  { text: 'sqlalchemy.exc.InterfaceError: (pg8000.exceptions.InterfaceError)', tone: 'error' },
  { text: 'in failed transaction block', tone: 'error' },
];

const color = (tone?: string): string => {
  if (tone === 'error') return C.red;
  if (tone === 'code') return C.muted;
  if (tone === 'info') return C.faint;
  return C.text;
};

export const Logs: React.FC = () => {
  const frame = useCurrentFrame();

  const reveal = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Lines land in sequence, as if streaming in.
  const shown = Math.min(LINES.length, Math.floor(interpolate(frame, [10, 78], [0, LINES.length])));

  const captionIn = interpolate(frame, [86, 106], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <Backdrop glow={0.3} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Terminal title="muster — logs" width={1420} height={505} fontSize={20} reveal={reveal}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ marginBottom: 16, fontFamily: mono }}>
              <span style={{ color: C.amber }}>logs </span>
              <span style={{ color: C.text, fontWeight: 600 }}>FastAPI </span>
              <span style={{ color: C.faint }}>(docq/api) </span>
              <span style={{ color: C.faint }}>paused </span>
              <span style={{ color: C.faint }}>1–18 of 184</span>
            </div>

            <div style={{ fontFamily: mono, lineHeight: 1.6 }}>
              {LINES.slice(0, shown).map((line, i) => (
                <div
                  key={i}
                  style={{
                    color: color(line.tone),
                    opacity: 1,
                    whiteSpace: 'pre',
                  }}
                >
                  {line.text}
                </div>
              ))}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 18 }}>
              <KeyBar
                keys={[
                  ['esc', 'back'],
                  ['f', 'follow'],
                  ['v', 'level: all'],
                  ['w', 'wrap: on'],
                  ['/', 'filter'],
                  ['q', 'quit'],
                ]}
              />
            </div>
          </div>
        </Terminal>
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'flex-end',
          paddingBottom: 54,
          opacity: captionIn,
        }}
      >
        <div style={{ fontFamily: sans, fontWeight: 600, fontSize: 34, color: C.muted }}>
          Every service's logs, <span style={{ color: C.amber }}>in one place</span> — filtered,
          levelled, nothing truncated.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
