const DEFAULT_WORKER_INTERNAL_PORT = 4000;
const MAX_PORT = 65535;

type WorkerPortEnvironment = Readonly<Record<string, string | undefined>>;

function parsePort(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;

  const port = Number(trimmed);
  return port >= 1 && port <= MAX_PORT ? port : undefined;
}

export function resolveWorkerInternalPort(env: WorkerPortEnvironment): number {
  return parsePort(env.PORT) ?? parsePort(env.WORKER_INTERNAL_PORT) ?? DEFAULT_WORKER_INTERNAL_PORT;
}
