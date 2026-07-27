import React from 'react';
import { C } from '../theme';
import { mono } from '../fonts';

export type ServiceState = 'idle' | 'starting' | 'running';

export type Service = {
  id: string;
  name: string;
  port?: number;
  command: string;
};

/**
 * The status glyphs the CLI actually uses (src/cli/render.ts statusDot):
 * ● running/failed/stopped, ◐ starting. Keeping them identical means the
 * video shows the product rather than an idealised version of it.
 */
const DOT: Record<ServiceState, { glyph: string; color: string }> = {
  idle: { glyph: '●', color: C.faint },
  starting: { glyph: '◐', color: C.yellow },
  running: { glyph: '●', color: C.green },
};

const Row: React.FC<{
  service: Service;
  state: ServiceState;
  selected?: boolean;
  /** 0–1, fades the row in on first paint. */
  reveal?: number;
  /**
   * 0–1, decaying: how recently this service came up. Drives a one-shot
   * flash across the row and a pop on the dot, so five services starting
   * reads as five events rather than as a colour change.
   */
  justReady?: number;
}> = ({ service, state, selected, reveal = 1, justReady = 0 }) => {
  const dot = DOT[state];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 14,
        padding: '4px 12px',
        borderRadius: 8,
        background: selected
          ? 'rgba(255,180,84,0.10)'
          : `rgba(78,203,113,${0.16 * justReady})`,
        opacity: reveal,
        transform: `translateX(${justReady * 5}px)`,
      }}
    >
      <span style={{ color: C.amber, width: 16 }}>{selected ? '▸' : ' '}</span>
      <span
        style={{
          color: dot.color,
          width: 18,
          display: 'inline-block',
          transform: `scale(${1 + justReady * 0.7})`,
          textShadow: justReady > 0 ? `0 0 ${18 * justReady}px ${dot.color}` : undefined,
        }}
      >
        {dot.glyph}
      </span>
      <span style={{ color: C.text, minWidth: 190 }}>{service.name}</span>
      <span style={{ color: C.blue, minWidth: 78 }}>
        {service.port ? `:${service.port}` : ''}
      </span>
      <span style={{ color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {service.command}
      </span>
    </div>
  );
};

export const Dashboard: React.FC<{
  workspace: string;
  groupId: string;
  groupLabel: string;
  services: Service[];
  states: ServiceState[];
  selected?: number;
  /** 0–1 per row, for staggered entrances. */
  rowReveal?: number[];
  /** 0–1 per row, decaying — see Row.justReady. */
  rowFlash?: number[];
  activity?: string;
  showFooter?: boolean;
}> = ({
  workspace,
  groupId,
  groupLabel,
  services,
  states,
  selected,
  rowReveal,
  rowFlash,
  activity,
  showFooter = true,
}) => {
  const running = states.filter((s) => s === 'running').length;
  const groupState =
    running === services.length ? 'running' : states.some((s) => s !== 'idle') ? 'starting' : 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: mono }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 22 }}>
        <span
          style={{
            background: C.amber,
            color: '#1a1204',
            fontWeight: 600,
            padding: '2px 10px',
            borderRadius: 4,
            letterSpacing: '0.08em',
          }}
        >
          MUSTER
        </span>
        <span style={{ color: C.faint }}>{workspace}</span>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          padding: '4px 12px',
        }}
      >
        <span style={{ width: 16 }} />
        <span style={{ color: DOT[groupState as ServiceState].color, width: 18 }}>
          {DOT[groupState as ServiceState].glyph}
        </span>
        <span style={{ color: C.text, fontWeight: 600 }}>{groupId}</span>
        <span style={{ color: C.muted }}>{groupLabel}</span>
        <span style={{ color: C.faint }}>dedicated/parallel</span>
        <span
          style={{
            color: groupState === 'running' ? C.green : C.faint,
            marginLeft: 'auto',
          }}
        >
          {/* Counts up as each service lands, rather than jumping from
              "starting…" straight to the full total — which is also what
              the real dashboard shows. */}
          {groupState === 'idle'
            ? 'idle'
            : running === 0
              ? 'starting…'
              : `${running}/${services.length} running`}
        </span>
      </div>

      <div style={{ marginTop: 6 }}>
        {services.map((service, i) => (
          <Row
            key={service.id}
            service={service}
            state={states[i]}
            selected={selected === i}
            reveal={rowReveal?.[i] ?? 1}
            justReady={rowFlash?.[i] ?? 0}
          />
        ))}
      </div>

      <div style={{ marginTop: 'auto' }}>
        {activity ? (
          <div style={{ color: C.faint, padding: '0 12px 12px' }}>
            <span style={{ color: C.amber }}>‣</span> {activity}
          </div>
        ) : null}
        {showFooter ? <KeyBar /> : null}
      </div>
    </div>
  );
};

/** The footer button bar, same keys and order as the real dashboard. */
export const KeyBar: React.FC<{ keys?: [string, string][] }> = ({
  keys = [
    ['r', 'run'],
    ['s', 'stop'],
    ['x', 'restart'],
    ['l', 'logs'],
    ['e', 'edit'],
    ['/', 'filter'],
    [':', 'commands'],
    ['q', 'quit'],
  ],
}) => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: '0.82em' }}>
    {keys.map(([key, label]) => (
      <span key={key} style={{ display: 'flex' }}>
        <span
          style={{
            background: C.amber,
            color: '#1a1204',
            padding: '2px 9px',
            borderRadius: '4px 0 0 4px',
            fontWeight: 600,
          }}
        >
          {key}
        </span>
        <span
          style={{
            background: 'rgba(255,255,255,0.07)',
            color: C.muted,
            padding: '2px 10px',
            borderRadius: '0 4px 4px 0',
          }}
        >
          {label}
        </span>
      </span>
    ))}
  </div>
);
