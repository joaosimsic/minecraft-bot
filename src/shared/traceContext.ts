import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

type TraceStore = {
  traceId: string;
};

const storage = new AsyncLocalStorage<TraceStore>();

export function getTraceId(): string | undefined {
  return storage.getStore()?.traceId;
}

export async function withNavigatorTrace<T>(fn: () => Promise<T>): Promise<T> {
  const traceId = randomUUID();
  return storage.run({ traceId }, fn);
}
