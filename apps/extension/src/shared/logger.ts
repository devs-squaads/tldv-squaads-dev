const PREFIX = "[squaads-ext]";

export function logInfo(message: string, meta?: unknown) {
  if (meta !== undefined) {
    console.log(`${PREFIX} ${message}`, meta);
    return;
  }
  console.log(`${PREFIX} ${message}`);
}

export function logWarn(message: string, meta?: unknown) {
  if (meta !== undefined) {
    console.warn(`${PREFIX} ${message}`, meta);
    return;
  }
  console.warn(`${PREFIX} ${message}`);
}

export function logError(message: string, meta?: unknown) {
  if (meta !== undefined) {
    console.error(`${PREFIX} ${message}`, meta);
    return;
  }
  console.error(`${PREFIX} ${message}`);
}
