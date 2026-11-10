import assert from 'node:assert/strict';
import test from 'node:test';

import { QueueManager, normalizeConfig } from '../lib/queue.js';

/** 最小的假 ctx：只实现插件用到的 on/logger/inject/get。 */
function fakeContext() {
  const listeners = new Map();
  return {
    logger: { info() {}, warn() {} },
    on(name, callback) {
      listeners.set(name, callback);
      return () => listeners.delete(name);
    },
    inject(_deps, callback) {
      callback({ get: () => undefined, logger: { info() {}, warn() {} } });
    },
    get: () => undefined,
    fire(name, ...args) {
      const callback = listeners.get(name);
      return callback ? callback(...args) : undefined;
    },
    has(name) {
      return listeners.has(name);
    },
  };
}

/** 假的上游流：记录被调用的时刻，然后吐两个 chunk。 */
function fakeUpstream(calls) {
  return async function* stream() {
    calls.push(Date.now());
    yield { type: 'delta', text: 'a' };
    yield { type: 'finish', reason: { kind: 'stop' } };
  };
}

async function drain(iterable) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

test('插件把超预算的请求挡住，不在排队期间调用上游', async () => {
  const { apply } = await import('../lib/index.js');
  const ctx = fakeContext();
  apply(ctx, {
    enabled: true,
    routes: [
      {
        id: 'mf',
        name: 'mf',
        providers: ['modelflare'],
        models: [],
        enabled: true,
        rate: { mode: 'spaced', rpm: 600, burst: 1, max_concurrent: 1, max_wait_seconds: 0 },
      },
    ],
  });

  assert.ok(ctx.has('llm/stream'), '插件必须挂上 llm/stream 钩子');

  const calls = [];
  const upstream = fakeUpstream(calls);
  const next = () => upstream();

  const first = ctx.fire('llm/stream', { provider: 'modelflare', model: 'deepseek-v4.1-flash' }, next);
  const second = ctx.fire('llm/stream', { provider: 'modelflare', model: 'deepseek-v4.1-flash' }, next);

  const firstDone = drain(first);
  const secondDone = drain(second);

  await firstDone;
  assert.equal(calls.length, 1, '第二个请求必须等到第一个流结束后才允许发上游');

  const chunks = await secondDone;
  assert.equal(calls.length, 2);
  assert.equal(chunks.at(-1).type, 'finish');
});

test('不匹配的 provider 完全透传，不排队也不留记录', async () => {
  const { apply } = await import('../lib/index.js');
  const ctx = fakeContext();
  apply(ctx, {
    enabled: true,
    routes: [
      { id: 'mf', name: 'mf', providers: ['modelflare'], models: [], enabled: true, rate: { rpm: 1 } },
    ],
  });

  const calls = [];
  const stream = ctx.fire('llm/stream', { provider: 'bytecat', model: 'claude-opus-5' }, () => fakeUpstream(calls)());
  const chunks = await drain(stream);
  assert.equal(chunks.length, 2, '未命中的 provider 应原样拿到全部 chunk');
});

test('upstream 抛错时槽位会被释放，不会卡死队列', async () => {
  const { apply } = await import('../lib/index.js');
  const ctx = fakeContext();
  apply(ctx, {
    enabled: true,
    routes: [
      { id: 'mf', name: 'mf', providers: ['modelflare'], models: [], enabled: true, rate: { rpm: 6000, max_concurrent: 1 } },
    ],
  });

  const failing = async function* () {
    yield { type: 'delta' };
    throw new Error('boom');
  };
  const stream = ctx.fire('llm/stream', { provider: 'modelflare', model: 'm' }, () => failing());
  await assert.rejects(drain(stream), /boom/);

  // 槽位已归还：下一个请求应当立刻能过
  const ok = ctx.fire('llm/stream', { provider: 'modelflare', model: 'm' }, () => fakeUpstream([])());
  const chunks = await drain(ok);
  assert.equal(chunks.at(-1).type, 'finish');
});

test('QueueManager 记录请求日志', () => {
  const manager = new QueueManager(normalizeConfig({ routes: [{ id: 'mf', providers: ['modelflare'] }] }));
  manager.record({ time: new Date().toISOString(), provider: 'modelflare', model: 'm', wait: 1.2, state: 'completed' });
  assert.equal(manager.snapshot().log.length, 1);
  manager.reset();
  assert.equal(manager.snapshot().log.length, 0);
});
