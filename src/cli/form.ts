/**
 * The dashboard's config forms: a service or group presented as a list of
 * editable rows, and the patches that come back out.
 *
 * Pure — the TUI draws rows and collects keystrokes, but every rule about
 * what a field accepts, what "add a step" means, and how removing one
 * changes the shape of the config lives here where it can be tested
 * without a terminal.
 *
 * Service ids are deliberately not editable: `dependsOn` refers to them and
 * log history is filed under them, so renaming one from a form would break
 * things elsewhere with no warning. Delete and re-add is the honest route.
 */
import type { GroupConfig, ServiceConfig } from '../config/schema';
import { effectiveCommand } from '../config/schema';
import { slugifyId } from '../config/slugify';
import type { GroupPatch, ServicePatch } from '../config/mutate';

/**
 * Words that say how something runs rather than what it is. Naming a
 * service after the first word of its command gives every JS service in
 * the group the id "npm", so step over the runner to the part that
 * actually distinguishes it.
 */
const RUNNERS = new Set([
  'npm', 'pnpm', 'yarn', 'bun', 'npx', 'pnpx', 'bunx', 'node', 'deno',
  'python', 'python3', 'py', 'poetry', 'pipenv', 'uv', 'pdm', 'rye',
  'cargo', 'go', 'make', 'just', 'task', 'docker', 'podman', 'dotnet',
  'run', 'exec', '-m', 'compose',
]);

/** A default id for a new service: "npm run worker" → "worker". */
export function guessServiceId(command: string): string {
  const words = command.trim().split(/\s+/).filter((w) => w.length > 0);
  let i = 0;
  // Always keep the last word, so a command of nothing but runners still
  // yields something rather than falling off the end.
  while (i < words.length - 1 && RUNNERS.has(words[i].toLowerCase())) i++;
  return slugifyId(words[i] ?? '', 'service');
}

/** Suffix until it doesn't collide — two `dev` services shouldn't error out. */
export function uniqueServiceId(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

export type FormRow = {
  /** Stable within a form: 'name', 'command', 'step:0', 'svc:web'. */
  id: string;
  label: string;
  /** Display value; empty renders as a dim placeholder. */
  value: string;
  /** What enter does. */
  edit: 'text' | 'number' | 'choice' | 'add' | 'open' | 'action';
  choices?: string[];
  hint?: string;
  /** `x` clears (optional field) or removes (step, service) this row. */
  remove?: 'clear' | 'delete';
  /** `[` / `]` reorder this row among its siblings. */
  movable?: boolean;
};

const PLACEHOLDER = 'not set';

/** Rows for one service: name, its command or steps, then the optional bits. */
export function serviceForm(svc: ServiceConfig): FormRow[] {
  const rows: FormRow[] = [{ id: 'name', label: 'name', value: svc.name, edit: 'text' }];

  if (svc.commands?.length) {
    svc.commands.forEach((cmd, i) => {
      rows.push({
        id: `step:${i}`,
        label: `step ${i + 1}`,
        value: cmd,
        edit: 'text',
        remove: 'delete',
        movable: true,
      });
    });
  } else {
    rows.push({ id: 'command', label: 'command', value: svc.command ?? '', edit: 'text' });
  }

  rows.push({
    id: 'add-step',
    label: '+ add step',
    value: '',
    edit: 'add',
    hint: 'chained with && — a step that fails stops the ones after it',
  });
  rows.push({
    id: 'cwd',
    label: 'cwd',
    value: svc.cwd ?? '',
    edit: 'text',
    remove: 'clear',
    hint: 'defaults to the workspace root',
  });
  rows.push({
    id: 'port',
    label: 'port',
    value: svc.port === undefined ? '' : String(svc.port),
    edit: 'number',
    remove: 'clear',
    hint: 'substituted into ${port} in the command',
  });
  rows.push({
    id: 'venv',
    label: 'python venv',
    value: svc.python?.venv ?? '',
    edit: 'text',
    remove: 'clear',
  });
  rows.push({
    id: 'node',
    label: 'node version',
    value: svc.node?.version ?? '',
    edit: 'text',
    remove: 'clear',
  });
  return rows;
}

/** Rows for a group: its settings, its services, and its hooks. */
export function groupForm(group: GroupConfig): FormRow[] {
  const rows: FormRow[] = [
    { id: 'label', label: 'label', value: group.label, edit: 'text' },
    {
      id: 'layout',
      label: 'layout',
      value: group.layout,
      edit: 'choice',
      choices: ['dedicated', 'aggregated', 'split'],
      hint: 'how the extension arranges terminals',
    },
    {
      id: 'order',
      label: 'order',
      value: group.order,
      edit: 'choice',
      choices: ['parallel', 'sequence'],
      hint: 'sequence honours dependsOn and delayMs',
    },
  ];

  for (const svc of group.services) {
    rows.push({
      id: `svc:${svc.id}`,
      label: `  ${svc.id}`,
      value: effectiveCommand(svc),
      edit: 'open',
      remove: 'delete',
    });
  }
  rows.push({ id: 'add-service', label: '+ add service', value: '', edit: 'add' });

  (group.hooks?.preRun ?? []).forEach((cmd, i) => {
    rows.push({
      id: `preRun:${i}`,
      label: `  preRun ${i + 1}`,
      value: cmd,
      edit: 'text',
      remove: 'delete',
      movable: true,
    });
  });
  rows.push({
    id: 'add-preRun',
    label: '+ add preRun hook',
    value: '',
    edit: 'add',
    hint: 'runs once before the group starts — migrations, docker compose up',
  });

  (group.hooks?.postStop ?? []).forEach((cmd, i) => {
    rows.push({
      id: `postStop:${i}`,
      label: `  postStop ${i + 1}`,
      value: cmd,
      edit: 'text',
      remove: 'delete',
      movable: true,
    });
  });
  rows.push({
    id: 'add-postStop',
    label: '+ add postStop hook',
    value: '',
    edit: 'add',
    hint: 'runs after the group stops — teardown, cleanup',
  });

  rows.push({
    id: 'delete-group',
    label: '✕ delete group',
    value: '',
    edit: 'action',
    hint: 'stops it, then removes it from the config',
  });

  return rows;
}

/** Display text for a row's value, so the TUI doesn't decide this twice. */
export function rowValue(row: FormRow): { text: string; muted: boolean } {
  if (row.edit === 'add') return { text: row.hint ?? '', muted: true };
  if (!row.value) return { text: PLACEHOLDER, muted: true };
  return { text: row.value, muted: false };
}

function stepIndex(rowId: string, prefix: string): number | null {
  if (!rowId.startsWith(`${prefix}:`)) return null;
  const n = Number(rowId.slice(prefix.length + 1));
  return Number.isInteger(n) ? n : null;
}

/** The current steps of a service, whether it stores one command or many. */
function steps(svc: ServiceConfig): string[] {
  if (svc.commands?.length) return [...svc.commands];
  return svc.command ? [svc.command] : [];
}

/**
 * A list of steps as a patch. One step collapses back to `command` — the
 * schema treats them as mutually exclusive, and a config that grew a
 * `commands` array only to shrink again shouldn't keep the scaffolding.
 */
function stepsPatch(list: string[]): ServicePatch {
  if (list.length === 1) return { command: list[0] };
  return { commands: list };
}

/** Applying a typed value to a service row. Throws with a message to show. */
export function applyServiceEdit(
  svc: ServiceConfig,
  rowId: string,
  raw: string
): ServicePatch {
  const value = raw.trim();

  if (rowId === 'name') {
    if (!value) throw new Error('name cannot be empty');
    return { name: value };
  }
  if (rowId === 'command') {
    if (!value) throw new Error('a service needs a command');
    return { command: value };
  }
  if (rowId === 'add-step') {
    if (!value) return {};
    return stepsPatch([...steps(svc), value]);
  }
  const step = stepIndex(rowId, 'step');
  if (step !== null) {
    if (!value) throw new Error('a step cannot be empty — press x to remove it');
    const list = steps(svc);
    if (step >= list.length) throw new Error('that step no longer exists');
    list[step] = value;
    return stepsPatch(list);
  }
  if (rowId === 'cwd') return { cwd: value || null };
  if (rowId === 'venv') return { python: value ? { venv: value } : null };
  if (rowId === 'node') return { node: value ? { version: value } : null };
  if (rowId === 'port') {
    if (!value) return { port: null };
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`"${value}" is not a port between 1 and 65535`);
    }
    return { port };
  }
  throw new Error(`Cannot edit "${rowId}"`);
}

/** `x` on a service row: clear an optional field, or drop a step. */
export function removeServiceRow(svc: ServiceConfig, rowId: string): ServicePatch {
  const step = stepIndex(rowId, 'step');
  if (step !== null) {
    const list = steps(svc);
    if (list.length <= 1) throw new Error('a service needs a command — edit it instead');
    list.splice(step, 1);
    return stepsPatch(list);
  }
  if (rowId === 'cwd') return { cwd: null };
  if (rowId === 'port') return { port: null };
  if (rowId === 'venv') return { python: null };
  if (rowId === 'node') return { node: null };
  throw new Error('nothing to remove here');
}

/** `[` / `]` on a step. Order matters: the steps chain with &&. */
export function moveServiceStep(
  svc: ServiceConfig,
  rowId: string,
  delta: -1 | 1
): ServicePatch {
  const step = stepIndex(rowId, 'step');
  if (step === null) throw new Error('only steps can be reordered');
  const list = steps(svc);
  const to = step + delta;
  if (to < 0 || to >= list.length) return {};
  [list[step], list[to]] = [list[to], list[step]];
  return stepsPatch(list);
}

/** Where the cursor should land after a step moved, so it follows the step. */
export function movedStepRow(rowId: string, delta: -1 | 1): string {
  const step = stepIndex(rowId, 'step');
  return step === null ? rowId : `step:${step + delta}`;
}

export type GroupHookPatch = GroupPatch & {
  hooks?: { preRun?: string[]; postStop?: string[] } | null;
};

function hookList(group: GroupConfig, which: 'preRun' | 'postStop'): string[] {
  return [...(group.hooks?.[which] ?? [])];
}

/**
 * Hooks as a patch, dropping the key entirely once both lists are empty so
 * an emptied config doesn't keep an orphaned `"hooks": {}`.
 */
function hooksPatch(group: GroupConfig, which: 'preRun' | 'postStop', list: string[]): GroupHookPatch {
  const other = which === 'preRun' ? 'postStop' : 'preRun';
  const merged = { [which]: list, [other]: hookList(group, other) } as {
    preRun: string[];
    postStop: string[];
  };
  const kept = Object.fromEntries(Object.entries(merged).filter(([, v]) => v.length > 0));
  return { hooks: Object.keys(kept).length > 0 ? kept : null };
}

export function applyGroupEdit(
  group: GroupConfig,
  rowId: string,
  raw: string
): GroupHookPatch {
  const value = raw.trim();

  if (rowId === 'label') {
    if (!value) throw new Error('label cannot be empty');
    return { label: value };
  }
  if (rowId === 'layout' || rowId === 'order') {
    return { [rowId]: value } as GroupHookPatch;
  }
  for (const which of ['preRun', 'postStop'] as const) {
    if (rowId === `add-${which}`) {
      if (!value) return {};
      return hooksPatch(group, which, [...hookList(group, which), value]);
    }
    const index = stepIndex(rowId, which);
    if (index !== null) {
      if (!value) throw new Error('a hook cannot be empty — press x to remove it');
      const list = hookList(group, which);
      if (index >= list.length) throw new Error('that hook no longer exists');
      list[index] = value;
      return hooksPatch(group, which, list);
    }
  }
  throw new Error(`Cannot edit "${rowId}"`);
}

export function removeGroupRow(group: GroupConfig, rowId: string): GroupHookPatch {
  for (const which of ['preRun', 'postStop'] as const) {
    const index = stepIndex(rowId, which);
    if (index !== null) {
      const list = hookList(group, which);
      list.splice(index, 1);
      return hooksPatch(group, which, list);
    }
  }
  throw new Error('nothing to remove here');
}

export function moveGroupHook(
  group: GroupConfig,
  rowId: string,
  delta: -1 | 1
): GroupHookPatch {
  for (const which of ['preRun', 'postStop'] as const) {
    const index = stepIndex(rowId, which);
    if (index === null) continue;
    const list = hookList(group, which);
    const to = index + delta;
    if (to < 0 || to >= list.length) return {};
    [list[index], list[to]] = [list[to], list[index]];
    return hooksPatch(group, which, list);
  }
  throw new Error('only hooks can be reordered');
}

/** The service id a `svc:` row points at. */
export function rowServiceId(rowId: string): string | null {
  return rowId.startsWith('svc:') ? rowId.slice(4) : null;
}

/** True when the row is a step or hook, which `[` / `]` can reorder. */
export function isMovable(row: FormRow | undefined): boolean {
  return Boolean(row?.movable);
}
