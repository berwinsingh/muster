import * as fs from 'fs';

export function loadEnvFile(envFile: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(envFile)) {
    return env;
  }
  const content = fs.readFileSync(envFile, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function buildServiceEnv(service: {
  env?: Record<string, string>;
  envFile?: string;
  port?: number;
}): NodeJS.ProcessEnv {
  const base: Record<string, string | undefined> = { ...process.env };
  // A declared port becomes the PORT env var, but explicit env config
  // (env map or envFile) always wins over the convenience default.
  if (service.port !== undefined) {
    base.PORT = String(service.port);
  }
  if (service.envFile) {
    Object.assign(base, loadEnvFile(service.envFile));
  }
  if (service.env) {
    Object.assign(base, service.env);
  }
  return base as NodeJS.ProcessEnv;
}
