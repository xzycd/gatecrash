import {describe, expect, it} from 'vitest';
import {parseConfig} from '../src/core/config.js';
import {GuestlistError} from '../src/core/errors.js';

function source(): Record<string, unknown> {
  return {
    target: {origin: 'https://app.example.test'},
    profiles: {
      admin: {
        level: 100,
        headers: {Authorization: 'Bearer ${ADMIN_TOKEN}'},
      },
      member: {
        level: 10,
        cookies: {session: '${MEMBER_COOKIE}'},
      },
    },
    compare: {baseline: 'admin'},
  };
}

describe('config', () => {
  it('applies conservative defaults and expands environment variables', () => {
    const config = parseConfig(source(), {
      ADMIN_TOKEN: 'admin-secret',
      MEMBER_COOKIE: 'member-secret',
    });

    expect(config.target).toMatchObject({
      origin: 'https://app.example.test',
      concurrency: 4,
      requestsPerSecond: 2,
      timeoutMs: 10_000,
    });
    expect(config.compare).toMatchObject({baseline: 'admin', against: ['member']});
    expect(config.profiles[0]?.headers.Authorization).toBe('Bearer admin-secret');
    expect(config.profiles[1]?.cookies.session).toBe('member-secret');
  });

  it('names missing secret variables without exposing adjacent values', () => {
    expect(() => parseConfig(source(), {MEMBER_COOKIE: 'member-secret'})).toThrowError(
      /ADMIN_TOKEN/,
    );
  });

  it('rejects a target origin with a path and suggests the origin', () => {
    const value = source();
    value.target = {origin: 'https://app.example.test/app'};

    try {
      parseConfig(value, {ADMIN_TOKEN: 'a', MEMBER_COOKIE: 'b'});
      expect.fail('Expected config parsing to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(GuestlistError);
      expect((error as GuestlistError).hint).toContain('https://app.example.test');
    }
  });

  it('rejects profile references that do not exist', () => {
    const value = source();
    value.compare = {baseline: 'root'};
    expect(() => parseConfig(value, {ADMIN_TOKEN: 'a', MEMBER_COOKIE: 'b'})).toThrowError(
      /unknown profile "root"/,
    );
  });

  it('rejects a duplicated challenger', () => {
    const value = source();
    value.compare = {baseline: 'admin', against: ['member', 'member']};
    expect(() => parseConfig(value, {ADMIN_TOKEN: 'a', MEMBER_COOKIE: 'b'})).toThrowError(
      /same profile twice/,
    );
  });
});
