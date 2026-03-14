import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRouter } from '../src/server/router.js';

interface FixtureCase {
  seed: Array<Record<string, unknown>>;
  assertions: Array<{
    request: Record<string, unknown>;
    expectResultPath: string;
    equals: string;
  }>;
}

function hasSnakeCaseKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasSnakeCaseKeys);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => key.includes('_') || hasSnakeCaseKeys(nested));
  }
  return false;
}

function getByPath(input: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, segment) => {
    if (acc === null || acc === undefined) return undefined;
    if (Array.isArray(acc)) return acc[Number(segment)];
    if (typeof acc === 'object') return (acc as Record<string, unknown>)[segment];
    return undefined;
  }, input);
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0, dirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('contract conformance fixtures', () => {
  it('guarantees camelCase outputs while accepting snake_case aliases at input', () => {
    const fixtureDir = join(process.cwd(), 'tests/contract/v1');
    const fixtureFiles = readdirSync(fixtureDir).filter((name) => name.endsWith('.fixture.json'));

    for (const fileName of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(join(fixtureDir, fileName), 'utf8')) as FixtureCase;
      const dataDir = mkdtempSync(join(tmpdir(), 'claude-app-server-contract-'));
      dirs.push(dataDir);

      const router = createRouter({ dataDir });
      let lastThreadId = '';

      for (const request of fixture.seed) {
        const out = router.handle(resolvePlaceholders(request, lastThreadId));
        expect(hasSnakeCaseKeys(out)).toBe(false);
        if (out.response && 'result' in out.response) {
          const maybeThreadId = getByPath(out.response.result, 'threadId');
          if (typeof maybeThreadId === 'string') {
            lastThreadId = maybeThreadId;
          }
        }
      }

      for (const assertion of fixture.assertions) {
        const out = router.handle(resolvePlaceholders(assertion.request, lastThreadId));
        expect(out.response).toBeDefined();
        expect(hasSnakeCaseKeys(out)).toBe(false);
        expect(hasSnakeCaseKeys(out.events)).toBe(false);

        if (!out.response || !('result' in out.response)) {
          throw new Error(`Expected result response in fixture ${fileName}`);
        }

        const expected = assertion.equals === '$lastThreadId' ? lastThreadId : assertion.equals;
        expect(getByPath(out.response.result, assertion.expectResultPath)).toBe(expected);
      }
    }
  });
});

function resolvePlaceholders(input: unknown, lastThreadId: string): unknown {
  if (Array.isArray(input)) return input.map((item) => resolvePlaceholders(item, lastThreadId));
  if (!input || typeof input !== 'object') return input;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === '$lastThreadId') {
      out[key] = lastThreadId;
    } else {
      out[key] = resolvePlaceholders(value, lastThreadId);
    }
  }
  return out;
}
