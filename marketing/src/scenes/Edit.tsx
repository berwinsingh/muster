import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { C } from '../theme';
import { mono, sans } from '../fonts';
import { Backdrop } from '../components/Statement';
import { Terminal } from '../components/Terminal';
import { KeyBar } from '../components/Dashboard';

/**
 * The edit form. The step being added arrives partway through, which is
 * the actual behaviour: `a`, type it, enter, and a single-command service
 * becomes a `commands` list.
 */
const BASE = [
  { label: 'name', value: 'FastAPI' },
  { label: 'step 1', value: '. venv/bin/activate' },
  { label: 'step 2', value: 'pip install -r requirements.txt' },
];

const ADDED = { label: 'step 3', value: 'uvicorn main:app --reload --port 8011' };

const TAIL = [
  { label: '+ add step', value: 'chained with && — a step that fails stops the rest', hint: true },
  { label: 'cwd', value: '${workspaceFolder}/api' },
  { label: 'port', value: '8011' },
];

export const Edit: React.FC = () => {
  const frame = useCurrentFrame();

  const reveal = interpolate(frame, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const addedIn = interpolate(frame, [52, 70], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const captionIn = interpolate(frame, [80, 100], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const rows = [...BASE, { ...ADDED, appearing: true }, ...TAIL];

  return (
    <AbsoluteFill>
      <Backdrop glow={0.3} />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Terminal title="muster — edit" width={1420} height={545} fontSize={21} reveal={reveal}>
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ marginBottom: 20, fontFamily: mono }}>
              <span style={{ color: C.amber }}>edit </span>
              <span style={{ color: C.text, fontWeight: 600 }}>docq/api </span>
              <span style={{ color: C.faint }}>(.vscode/muster.json — saved as you go)</span>
            </div>

            <div style={{ fontFamily: mono, lineHeight: 1.9 }}>
              {rows.map((row, i) => {
                const appearing = 'appearing' in row && row.appearing;
                const hint = 'hint' in row && row.hint;
                return (
                  <div
                    key={row.label}
                    style={{
                      display: 'flex',
                      gap: 20,
                      opacity: appearing ? addedIn : 1,
                      transform: appearing ? `translateX(${(1 - addedIn) * -14}px)` : undefined,
                      height: appearing ? `${addedIn * 1.9}em` : undefined,
                      overflow: 'hidden',
                    }}
                  >
                    <span style={{ color: C.amber, width: 20 }}>{appearing ? '▸' : ' '}</span>
                    <span style={{ color: hint ? C.amber : C.muted, minWidth: 210 }}>
                      {row.label}
                    </span>
                    <span style={{ color: hint ? C.faint : C.text }}>{row.value}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 'auto', paddingTop: 18 }}>
              <KeyBar
                keys={[
                  ['esc', 'back'],
                  ['enter', 'edit'],
                  ['a', 'add'],
                  ['x', 'remove'],
                  ['[', 'move ↑'],
                  [']', 'move ↓'],
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
          Change a service <span style={{ color: C.amber }}>without leaving</span> — no JSON, no
          restart of your day.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
