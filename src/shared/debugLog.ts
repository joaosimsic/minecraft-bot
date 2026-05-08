const ENDPOINT =
  'http://127.0.0.1:7848/ingest/978eebf5-f58c-4f97-a648-f984488059ac';
const SESSION = '68083a';

export function debugLog(
  location: string,
  message: string,
  data: Record<string, unknown>,
  hypothesisId: string,
): void {
  fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': SESSION,
    },
    body: JSON.stringify({
      sessionId: SESSION,
      location,
      message,
      data,
      timestamp: Date.now(),
      hypothesisId,
    }),
  }).catch(() => {});
}
