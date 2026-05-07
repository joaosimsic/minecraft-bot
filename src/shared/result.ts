export type Result<T> = [Error | null, T | null];

export type AsyncResult<T> = Promise<Result<T>>;

export async function wrap<T>(p: Promise<T>): AsyncResult<T> {
  return p.then(
    (v): Result<T> => [null, v],

    (e): Result<T> => {
      const err = e instanceof Error ? e : new Error(String(e));
      return [err, null];
    },
  );
}

export function ok<T>(value: T): Result<T> {
  return [null, value];
}

export function okVoid(): Result<null> {
  return [null, null];
}

export function fail<T>(err: Error): Result<T> {
  return [err, null];
}
