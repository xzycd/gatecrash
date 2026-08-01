import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import type {CapturedRequest, GatecrashConfig} from './types.js';

function send(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(body);
}

function demoHandler(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://gatecrash.local');
  const user = request.headers['x-demo-user'];

  if (url.pathname === '/api/account/alice') {
    if (user === undefined) {
      send(response, 401, {error: 'sign in'});
      return;
    }

    // Deliberate horizontal access-control bug: Bob receives Alice's record.
    send(response, 200, {account: 'alice', plan: 'founder', balance: 4800});
    return;
  }

  if (url.pathname === '/api/member/export') {
    if (user === 'bob') {
      send(response, 200, {owner: 'bob', export: ['B-100', 'B-101']});
      return;
    }

    // Deliberate missing authentication check: anonymous gets Alice's export.
    send(response, 200, {owner: 'alice', export: ['A-200', 'A-201']});
    return;
  }

  if (url.pathname === '/api/me') {
    if (typeof user !== 'string') {
      send(response, 401, {error: 'sign in'});
      return;
    }
    send(response, 200, {username: user, workspace: `${user}-workspace`});
    return;
  }

  if (url.pathname === '/public') {
    send(response, 200, {service: 'doorlab', status: 'ok'});
    return;
  }

  if (url.pathname === '/api/profile' && request.method === 'POST') {
    send(response, 200, {saved: true});
    return;
  }

  send(response, 404, {error: 'not found'});
}

export interface DemoLab {
  origin: string;
  requests: CapturedRequest[];
  config: GatecrashConfig;
  close: () => Promise<void>;
}

export async function startDemoLab(): Promise<DemoLab> {
  const server = createServer(demoHandler);
  server.headersTimeout = 5_000;
  server.requestTimeout = 5_000;
  server.keepAliveTimeout = 1_000;
  server.maxRequestsPerSocket = 100;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const definitions: Array<{method: string; path: string; body?: string}> = [
    {method: 'GET', path: '/api/account/alice'},
    {method: 'GET', path: '/api/member/export'},
    {method: 'GET', path: '/api/me'},
    {method: 'GET', path: '/public'},
    {method: 'POST', path: '/api/profile', body: '{"displayName":"Alice"}'},
  ];
  const requests: CapturedRequest[] = definitions.map((definition, index) => ({
    method: definition.method,
    url: new URL(definition.path, origin),
    headers: {'content-type': 'application/json'},
    ...(definition.body === undefined ? {} : {body: definition.body}),
    source: `doorlab:${index + 1}`,
  }));

  const config: GatecrashConfig = {
    target: {
      origin,
      requestsPerSecond: 40,
      concurrency: 4,
      timeoutMs: 2_000,
      maxResponseBytes: 100_000,
    },
    profiles: [
      {name: 'alice', level: 10, headers: {'x-demo-user': 'alice'}, cookies: {}},
      {name: 'bob', level: 10, headers: {'x-demo-user': 'bob'}, cookies: {}},
      {name: 'anonymous', level: 0, headers: {}, cookies: {}},
    ],
    compare: {
      baseline: 'alice',
      against: ['bob', 'anonymous'],
      similarityThreshold: 0.92,
      volatileJsonKeys: ['requestId', 'timestamp'],
    },
    exclude: {
      paths: ['/public'],
      extensions: [],
    },
  };

  return {
    origin,
    requests,
    config,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      });
    },
  };
}
