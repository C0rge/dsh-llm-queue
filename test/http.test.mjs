import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const home = mkdtempSync(join(tmpdir(), 'dsh-llm-queue-'));
process.env.DSH_HOME = home;

const { apply } = await import('../lib/index.js');

/**
 * 捕获插件注册的路由 + 假 webServer。
 * 路由在真实进程里只注册一次，所以这里也只 mount 一次，全部用例共用同一张路由表。
 */
function mount() {
  const routes = new Map();
  const webServer = {
    register(route) {
      if (routes.has(route.path)) throw new Error(`duplicate ${route.path}`);
      routes.set(route.path, route);
      return () => routes.delete(route.path);
    },
  };
  const ctx = {
    logger: { info() {}, warn() {} },
    on() {},
    inject(_deps, callback) {
      callback({ get: (service) => (service === 'webServer' ? webServer : undefined), logger: ctx.logger });
    },
    get: () => undefined,
  };
  apply(ctx, {
    enabled: true,
    logSize: 20,
    routes: [
      { id: 'mf', name: 'mf', providers: ['modelflare'], models: [], enabled: true, rate: { mode: 'spaced', rpm: 3 } },
    ],
  });
  return { routes };
}

const mounted = mount();

/** 造一个够用的 req/res。 */
function makeExchange({ method = 'GET', body = null, remote = '127.0.0.1' } = {}) {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  const req = {
    method,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: remote },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
  let status = 0;
  let payload = '';
  const res = {
    writeHead(code) {
      status = code;
    },
    end(data) {
      payload = data ?? '';
    },
  };
  return {
    req,
    res,
    read: () => ({ status, payload, json: () => JSON.parse(payload) }),
  };
}

async function call(path, options) {
  const route = mounted.routes.get(path);
  assert.ok(route, `路由未注册：${path}`);
  const exchange = makeExchange(options);
  await route.handler(exchange.req, exchange.res);
  return exchange.read();
}

test('插件注册了面板与三个 API 路由', () => {
  assert.deepEqual(
    [...mounted.routes.keys()].sort(),
    ['/api/llm-queue/config', '/api/llm-queue/reset', '/api/llm-queue/state', '/llm-queue', '/llm-queue/'],
  );
});

test('面板页面是一份自包含的 HTML', async () => {
  const out = await call('/llm-queue');
  assert.equal(out.status, 200);
  assert.match(out.payload, /模型排队限速/);
  assert.match(out.payload, /const API = '\/api\/llm-queue'/);
  assert.match(out.payload, /API \+ '\/state'/);
  assert.ok(!out.payload.includes('http://localhost'), '面板必须用同源相对路径');
});

test('状态接口返回车道与有效 RPM', async () => {
  const out = await call('/api/llm-queue/state');
  assert.equal(out.status, 200);
  const state = out.json();
  assert.equal(state.lanes.length, 1);
  assert.equal(state.lanes[0].effective_rpm, 3);
  assert.equal(state.lanes[0].interval_seconds, 20);
  assert.ok(Array.isArray(state.log));
  assert.equal(state.page, '/llm-queue');
});

test('保存配置会落盘并即时生效', async () => {
  const out = await call('/api/llm-queue/config', {
    method: 'PUT',
    body: {
      enabled: true,
      logSize: 30,
      routes: [
        {
          id: 'mf',
          name: '改过的车道',
          providers: ['modelflare'],
          models: ['deepseek-v4.1-flash'],
          enabled: true,
          rate: { mode: 'burst', rpm: 10, burst: 2, max_concurrent: 2, max_wait_seconds: 5 },
        },
      ],
    },
  });
  assert.equal(out.status, 200);
  assert.equal(out.json().ok, true);

  const persisted = JSON.parse(readFileSync(join(home, 'llm-queue', 'config.json'), 'utf8'));
  assert.equal(persisted.routes[0].name, '改过的车道');
  assert.equal(persisted.routes[0].rate.mode, 'burst');

  const state = (await call('/api/llm-queue/state')).json();
  assert.equal(state.lanes[0].name, '改过的车道');
  assert.equal(state.lanes[0].rate.rpm, 10);
});

test('非法配置被拒绝，且不覆盖已保存的配置', async () => {
  const before = readFileSync(join(home, 'llm-queue', 'config.json'), 'utf8');
  const out = await call('/api/llm-queue/config', {
    method: 'PUT',
    body: { routes: [{ id: 'x', name: 'x', providers: [] }] },
  });
  assert.equal(out.status, 400);
  assert.match(out.json().error, /provider/);
  assert.equal(readFileSync(join(home, 'llm-queue', 'config.json'), 'utf8'), before);
});

test('非本机请求被拒绝', async () => {
  const out = await call('/api/llm-queue/state', { remote: '192.168.1.50' });
  assert.equal(out.status, 403);
});

test('统计可清零', async () => {
  const out = await call('/api/llm-queue/reset', { method: 'POST' });
  assert.equal(out.status, 200);
  assert.equal(out.json().ok, true);
});

test.after(() => {
  rmSync(home, { recursive: true, force: true });
});
