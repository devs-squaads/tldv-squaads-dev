interface WindowCounter {
  count: number;
  resetAt: number;
}

const counters = new Map<string, WindowCounter>();

function cleanup(now: number): void {
  for (const [key, value] of counters.entries()) {
    if (value.resetAt <= now) counters.delete(key);
  }
}

export function consumeRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  cleanup(now);

  const current = counters.get(key);
  if (!current || current.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (current.count >= limit) {
    return false;
  }

  current.count += 1;
  counters.set(key, current);
  return true;
}
