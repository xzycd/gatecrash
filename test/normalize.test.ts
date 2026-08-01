import {describe, expect, it} from 'vitest';
import {displayPath, normalizePath, prepareRoutes} from '../src/core/normalize.js';
import type {CapturedRequest} from '../src/core/types.js';

function request(method: string, url: string): CapturedRequest {
  return {method, url: new URL(url), headers: {}, source: 'test'};
}

describe('route preparation', () => {
  it('keeps query names encoded so controls never enter a report path', () => {
    expect(displayPath(new URL('https://app.example.test/search?%1B%5B31m=secret&q=value'))).toEqual({
      path: '/search?%1B%5B31m&q',
      queryNames: ['%1B%5B31m', 'q'],
    });
  });

  it('normalizes common object identifiers without hiding the replay URL', () => {
    expect(normalizePath('/users/42/files/4f91a8d4-6e81-4da4-a96f-3ebf183ff234')).toBe(
      '/users/{int}/files/{uuid}',
    );
  });

  it('enforces origin, safe methods, exclusions, and exact deduplication', () => {
    const requests = [
      request('GET', 'https://app.example.test/api/users/42?expand=team&token=secret'),
      request('GET', 'https://app.example.test/api/users/42?expand=team&token=secret'),
      request('POST', 'https://app.example.test/api/users/42'),
      request('GET', 'https://cdn.example.test/app.js'),
      request('GET', 'https://app.example.test/health'),
    ];
    const result = prepareRoutes(
      requests,
      'https://app.example.test',
      new Set(['GET', 'HEAD', 'OPTIONS']),
      {paths: ['/health'], extensions: ['js']},
    );

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0]?.reportId).toBe('route-0001');
    expect(result.routes[0]).toMatchObject({
      path: '/api/users/42?expand&token',
      pattern: '/api/users/{int}',
      queryNames: ['expand', 'token'],
    });
    expect(result.skipped.map(({reason}) => reason).sort()).toEqual([
      'duplicate',
      'excluded',
      'out-of-scope',
      'unsafe-method',
    ]);
    expect(result.routes[0]?.path).not.toContain('secret');
    expect(result.routes[0]?.queryNames).toEqual(['expand', 'token']);
  });
});
