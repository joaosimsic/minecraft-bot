import { describe, expect, test } from 'bun:test';
import {
  buildOtlpMetricsIngestUrl,
  buildOtlpTracesIngestUrl,
} from '../src/shared/debugLog';

describe('buildOtlpTracesIngestUrl', () => {
  test('appends v1 traces once', (): void => {
    expect(buildOtlpTracesIngestUrl('http://127.0.0.1:4318')).toBe(
      'http://127.0.0.1:4318/v1/traces',
    );
  });

  test('strips trailing slash before append', (): void => {
    expect(buildOtlpTracesIngestUrl('http://127.0.0.1:4318/')).toBe(
      'http://127.0.0.1:4318/v1/traces',
    );
  });

  test('does not double v1 traces', (): void => {
    expect(buildOtlpTracesIngestUrl('http://127.0.0.1:4318/v1/traces')).toBe(
      'http://127.0.0.1:4318/v1/traces',
    );
  });

  test('strips duplicate path when pasted with trailing slash', (): void => {
    expect(buildOtlpTracesIngestUrl('http://127.0.0.1:4318/v1/traces/')).toBe(
      'http://127.0.0.1:4318/v1/traces',
    );
  });
});

describe('buildOtlpMetricsIngestUrl', () => {
  test('appends v1 metrics once', (): void => {
    expect(buildOtlpMetricsIngestUrl('http://127.0.0.1:4318')).toBe(
      'http://127.0.0.1:4318/v1/metrics',
    );
  });

  test('does not double v1 metrics', (): void => {
    expect(buildOtlpMetricsIngestUrl('http://127.0.0.1:4318/v1/metrics')).toBe(
      'http://127.0.0.1:4318/v1/metrics',
    );
  });
});
