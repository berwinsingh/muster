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
  problem: { from: 0, duration: 150 },     // 0.0s – 5.0s
  oneCommand: { from: 150, duration: 105 }, // 5.0s – 8.5s
  boot: { from: 255, duration: 255 },       // 8.5s – 17.0s
  logs: { from: 510, duration: 165 },       // 17.0s – 22.5s
  edit: { from: 675, duration: 150 },       // 22.5s – 27.5s
  agents: { from: 825, duration: 120 },     // 27.5s – 31.5s
  close: { from: 945, duration: 135 },      // 31.5s – 36.0s
} as const;

export const TOTAL_FRAMES =
  SCENES.close.from + SCENES.close.duration;
