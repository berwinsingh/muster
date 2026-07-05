import { ProcessTracker } from './processTracker';

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForReadyPattern(
  tracker: ProcessTracker,
  groupId: string,
  serviceId: string,
  pattern: string,
  timeoutMs = 120_000
): Promise<boolean> {
  const regex = new RegExp(pattern);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const output = tracker.getRecentOutput(groupId, serviceId, 100).join('\n');
    if (regex.test(output)) {
      tracker.setStatus(groupId, serviceId, 'running');
      return true;
    }
    const status = tracker.getService(groupId, serviceId)?.status;
    if (status === 'failed' || status === 'stopped') {
      return false;
    }
    await wait(500);
  }
  return false;
}

export async function waitForHealthUrl(url: string, timeoutMs = 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        return true;
      }
    } catch {
      // retry
    }
    await wait(1000);
  }
  return false;
}

export async function waitForServiceReady(
  tracker: ProcessTracker,
  groupId: string,
  serviceId: string,
  readyPattern?: string,
  healthUrl?: string,
  delayMs?: number
): Promise<void> {
  if (delayMs && delayMs > 0) {
    await wait(delayMs);
  }

  if (readyPattern) {
    const ok = await waitForReadyPattern(tracker, groupId, serviceId, readyPattern);
    if (!ok) {
      tracker.setStatus(groupId, serviceId, 'failed');
      throw new Error(`Service ${serviceId} did not become ready (pattern: ${readyPattern})`);
    }
  }

  if (healthUrl) {
    const ok = await waitForHealthUrl(healthUrl);
    if (!ok) {
      tracker.setStatus(groupId, serviceId, 'failed');
      throw new Error(`Service ${serviceId} health check failed: ${healthUrl}`);
    }
  }

  tracker.setStatus(groupId, serviceId, 'running');
}
