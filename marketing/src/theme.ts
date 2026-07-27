/**
 * Brand tokens, lifted verbatim from docs/index.html so the video and the
 * site can't drift apart. If the site palette changes, change it here too.
 */
export const C = {
  bg: '#0b0d10',
  bgRaise: '#12151a',
  bgCard: '#14181e',
  line: 'rgba(255, 255, 255, 0.08)',
  lineSoft: 'rgba(255, 255, 255, 0.05)',
  text: '#e8eaed',
  muted: '#9aa3ad',
  faint: '#6b7480',
  amber: '#ffb454',
  amberDeep: '#e89b2f',
  green: '#4ecb71',
  red: '#f47067',
  yellow: '#f2cc60',
  blue: '#6cb6ff',
} as const;

/** Per-service accent colours, matching the CLI's own PALETTE order. */
export const SERVICE_COLORS = [C.blue, C.green, C.yellow, C.amber, C.red];

export const FPS = 30;

/**
 * Scene boundaries in frames. Kept in one place so timing can be tuned
 * without hunting through components, and so scenes can cross-fade by
 * overlapping deliberately rather than by accident.
 */
export const SCENES = {
  problem: { from: 0, duration: 148 },      // 0.00s – 4.93s  (collapse at ~3.9s)
  oneCommand: { from: 148, duration: 92 },  // 4.93s – 8.00s
  boot: { from: 240, duration: 250 },       // 8.00s – 16.33s
  logs: { from: 490, duration: 145 },       // 16.33s – 21.17s
  edit: { from: 635, duration: 140 },       // 21.17s – 25.83s
  agents: { from: 775, duration: 125 },     // 25.83s – 30.00s
  close: { from: 900, duration: 150 },      // 30.00s – 35.00s
} as const;

export const TOTAL_FRAMES =
  SCENES.close.from + SCENES.close.duration;
