import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import {parseHar, parseUrlList} from '../src/core/capture.js';

const fixture = fileURLToPath(new URL('./fixtures/session.har', import.meta.url));

describe('capture ingestion', () => {
  it('drops captured credentials before replay', async () => {
    const value = JSON.parse(await readFile(fixture, 'utf8')) as unknown;
    const requests = parseHar(value, 'fixture.har');

    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers).toEqual({accept: 'application/json'});
    expect(requests[1]?.body).toBe('{"name":"changed"}');
  });

  it('drops conditional headers so every profile receives a comparable body', () => {
    const headers = [
      {name: 'If-None-Match', value: '"cached"'},
      {name: 'If-Modified-Since', value: 'yesterday'},
      {name: 'Range', value: 'bytes=0-10'},
      {name: 'Accept', value: 'application/json'},
    ];
    const value = {
      log: {entries: [{request: {method: 'GET', url: 'https://app.example.test/a', headers}}]},
    };
    expect(parseHar(value)[0]?.headers).toEqual({accept: 'application/json'});
  });

  it('reads plain URLs, explicit methods, and Katana-style JSONL', () => {
    const requests = parseUrlList([
      'https://app.example.test/a',
      'HEAD https://app.example.test/b',
      '{"request":{"method":"GET","endpoint":"https://app.example.test/c"}}',
    ].join('\n'));

    expect(requests.map(({method, url}) => `${method} ${url.pathname}`)).toEqual([
      'GET /a',
      'HEAD /b',
      'GET /c',
    ]);
  });

  it('does not accept relative or non-HTTP URLs', () => {
    expect(() => parseUrlList('/admin')).toThrowError(/Could not read line/);
    expect(() => parseUrlList('file:///etc/passwd')).toThrowError(/Could not read line/);
  });
});
