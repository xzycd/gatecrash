import {describe, expect, it} from 'vitest';
import {parseConfig} from '../src/core/config.js';
import {GatecrashError} from '../src/core/errors.js';

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
      expect(error).toBeInstanceOf(GatecrashError);
      expect((error as GatecrashError).hint).toContain('https://app.example.test');
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

  it('can inspect configuration without resolving session secrets', () => {
    const config = parseConfig(source(), {}, {resolveEnvironment: false});
    expect(config.profiles[0]?.headers.Authorization).toBe('Bearer <environment>');
    expect(config.profiles[1]?.cookies.session).toBe('<environment>');
  });

  it('rejects embedded target credentials', () => {
    const value = source();
    value.target = {origin: 'https://alice:secret@app.example.test'};
    expect(() => parseConfig(value, {ADMIN_TOKEN: 'a', MEMBER_COOKIE: 'b'})).toThrowError(
      /embedded credentials/,
    );
  });

  it('rejects transport headers and raw cookie headers in profiles', () => {
    const value = source();
    const profiles = value.profiles as Record<string, Record<string, unknown>>;
    profiles.admin = {level: 100, headers: {Host: 'other.example'}};
    expect(() => parseConfig(value, {MEMBER_COOKIE: 'b'})).toThrowError(/not an allowed/);

    profiles.admin = {level: 100, headers: {Cookie: 'session=secret'}};
    expect(() => parseConfig(value, {MEMBER_COOKIE: 'b'})).toThrowError(/not an allowed/);
  });

  it('rejects header injection and unsafe profile names', () => {
    const value = source();
    const profiles = value.profiles as Record<string, Record<string, unknown>>;
    profiles.admin = {level: 100, headers: {Authorization: 'ok\r\nX-Evil: yes'}};
    expect(() => parseConfig(value, {MEMBER_COOKIE: 'b'})).toThrowError(/invalid header value/);

    profiles.admin = {level: 100, headers: {Authorization: 'ok\u001B[31m'}};
    expect(() => parseConfig(value, {MEMBER_COOKIE: 'b'})).toThrowError(/invalid header value/);

    profiles.admin = {level: 100, headers: {Authorization: 'Bearer fixed'}};
    profiles['bad profile'] = profiles.member ?? {};
    delete profiles.member;
    expect(() => parseConfig(value, {})).toThrowError(/Profile name/);
  });

  it('rejects misspelled and unknown settings', () => {
    const value = source();
    const target = value.target as Record<string, unknown>;
    target.concurency = 8;
    expect(() => parseConfig(value, {ADMIN_TOKEN: 'a', MEMBER_COOKIE: 'b'})).toThrowError(
      /target\.concurency is not a supported setting/,
    );
  });

  it('caps profile maps before expanding their values', () => {
    const value = source();
    const profiles = value.profiles as Record<string, Record<string, unknown>>;
    profiles.admin = {
      level: 100,
      headers: Object.fromEntries(
        Array.from({length: 129}, (_, index) => [`X-Test-${index}`, '${SECRET}']),
      ),
    };
    expect(() => parseConfig(value, {MEMBER_COOKIE: 'b'})).toThrowError(/128 entries/);
  });
});
