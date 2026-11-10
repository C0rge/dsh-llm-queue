#!/usr/bin/env node
/**
 * dev/preview.mjs — 本地预览面板（不启动 DSH，纯调试用）
 *
 * 用法：node dev/preview.mjs [--port 8799]
 * 打开 http://127.0.0.1:8799/llm-queue
 */

import { createServer } from 'node:http';

const portIndex = process.argv.indexOf('--port');
const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 8799;

const { apply } = await import('../lib/index.js');

const routes = new Map();
const logger = { info: (m) => console.log('[info]', m), warn: (m) => console.log('[warn]', m) };
const webServer = {
  register(route) {
    routes.set(route.path, route);
    return () => routes.delete(route.path);
  },
};

apply(
  {
    logger,
    on() {},
    inject(_deps, callback) {
      callback({ get: (name) => (name === 'webServer' ? webServer : undefined), logger });
    },
    get: () => undefined,
  },
  {
    enabled: true,
    logSize: 50,
    routes: [
      {
        id: 'modelflare',
        name: 'ModelFlare（低价路由）',
        providers: ['modelflare'],
        models: [],
        enabled: true,
        rate: { mode: 'spaced', rpm: 3, burst: 1, max_concurrent: 1, max_wait_seconds: 0 },
      },
      {
        id: 'bytecat',
        name: 'ByteCat（对照）',
        providers: ['bytecat'],
        models: ['claude-opus-5'],
        enabled: false,
        rate: { mode: 'burst', rpm: 60, burst: 4, max_concurrent: 2, max_wait_seconds: 30 },
      },
    ],
  },
);

// 塞几条假记录，方便看排版
const manager = globalThis.__dshLlmQueuePlugin?.manager;
if (manager) {
  const now = Date.now();
  manager.record({ time: new Date(now - 42000).toISOString(), provider: 'modelflare', model: 'deepseek-v4.1-flash', wait: 0, elapsed: 4.2, state: 'completed' });
  manager.record({ time: new Date(now - 21000).toISOString(), provider: 'modelflare', model: 'deepseek-v4.1-flash', wait: 19.4, elapsed: 23.1, state: 'completed' });
  manager.record({ time: new Date(now - 8000).toISOString(), provider: 'modelflare', model: 'deepseek-v4-flash', wait: 20.1, elapsed: 44.7, state: 'error' });
  const lane = manager.laneFor('modelflare', 'deepseek-v4.1-flash');
  if (lane) {
    lane.stats.completed = 12;
    lane.stats.failed = 1;
    lane.stats.accepted = 13;
  }
}

const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname;
  const route = routes.get(path);
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
    return;
  }
  Promise.resolve(route.handler(req, res)).catch((error) => {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(String(error));
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${port}/llm-queue`);
});
