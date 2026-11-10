import assert from 'node:assert/strict';
import test from 'node:test';

import { Lane, QueueManager, normalizeConfig, normalizeRoute } from '../lib/queue.js';

const route = (over = {}) =>
  normalizeRoute(
    {
      id: 'r',
      name: 'r',
      providers: ['modelflare'],
      models: [],
      enabled: true,
      rate: { mode: 'spaced', rpm: 60, burst: 1, max_concurrent: 1, max_wait_seconds: 0 },
      ...over,
    },
    0,
  );

test('spaced 模式按间隔放行，第二个请求需要等待', async () => {
  const lane = new Lane(route({ rate: { mode: 'spaced', rpm: 600, burst: 1, max_concurrent: 1, max_wait_seconds: 0 } }));
  const first = await lane.acquire();
  assert.ok(first.wait < 0.05, `首个请求不该等待，实际 ${first.wait}`);
  const pending = lane.acquire();
  setTimeout(() => lane.release(true), 20);
  const second = await pending;
  assert.ok(second.wait >= 0.05, `第二个请求应等待，实际 ${second.wait}`);
  lane.release(true);
  assert.equal(lane.inFlight, 0);
});

test('并发上限生效：max_concurrent=1 时第二个必须等在飞释放', async () => {
  const lane = new Lane(route({ rate: { mode: 'spaced', rpm: 6000, burst: 1, max_concurrent: 1, max_wait_seconds: 0 } }));
  await lane.acquire();
  let granted = false;
  const pending = lane.acquire().then(() => {
    granted = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(granted, false, '在飞未释放时不应放行');
  lane.release(true);
  await pending;
  assert.equal(granted, true);
  lane.release(true);
});

test('取消：abort 后排队者被拒绝且不再占用槽位', async () => {
  const lane = new Lane(route({ rate: { mode: 'spaced', rpm: 6, burst: 1, max_concurrent: 1, max_wait_seconds: 0 } }));
  await lane.acquire();
  const controller = new AbortController();
  const pending = lane.acquire(controller.signal);
  controller.abort();
  await assert.rejects(pending, /取消/);
  assert.equal(lane.waiters.filter((w) => !w.settled).length, 0);
  lane.release(true);
});

test('max_wait_seconds 到点后抛超时错误', async () => {
  const lane = new Lane(route({ rate: { mode: 'spaced', rpm: 1, burst: 1, max_concurrent: 1, max_wait_seconds: 0.2 } }));
  await lane.acquire();
  await assert.rejects(lane.acquire(), /超过 max_wait_seconds/);
  assert.equal(lane.stats.expired, 1);
  lane.release(true);
});

test('laneFor 只匹配命中 provider 与模型白名单的请求', () => {
  const config = normalizeConfig({
    enabled: true,
    logSize: 50,
    routes: [
      { id: 'mf', name: 'mf', providers: ['modelflare'], models: [], rate: { rpm: 3 } },
      { id: 'bc', name: 'bc', providers: ['bytecat'], models: ['claude-opus-5'], rate: { rpm: 1 } },
    ],
  });
  const manager = new QueueManager(config);
  assert.equal(manager.laneFor('modelflare', 'deepseek-v4.1-flash')?.id, 'mf');
  assert.equal(manager.laneFor('bytecat', 'claude-opus-5')?.id, 'bc');
  assert.equal(manager.laneFor('bytecat', 'claude-sonnet-5'), null, '模型不在白名单就不该被限速');
  assert.equal(manager.laneFor('openai', 'gpt-5'), null, '未配置的 provider 必须直连');
});

test('总开关关闭后所有请求都不进队列', () => {
  const config = normalizeConfig({ enabled: false, routes: [{ id: 'mf', providers: ['modelflare'] }] });
  const manager = new QueueManager(config);
  assert.equal(manager.laneFor('modelflare', 'x'), null);
});

test('normalizeConfig 拒绝非法输入', () => {
  assert.throws(() => normalizeConfig({ routes: [{ id: 'a', providers: [] }] }), /至少要填一个 provider/);
  assert.throws(() => normalizeConfig({ routes: [{ id: 'a', providers: ['x'] }, { id: 'a', providers: ['y'] }] }), /id 重复/);
});

test('配置热更新会保留队列与统计', () => {
  const config = normalizeConfig({ routes: [{ id: 'mf', providers: ['modelflare'], rate: { rpm: 3 } }] });
  const manager = new QueueManager(config);
  const lane = manager.laneFor('modelflare', 'm');
  lane.stats.completed = 7;
  manager.apply(normalizeConfig({ routes: [{ id: 'mf', name: '改名', providers: ['modelflare'], rate: { rpm: 6 } }] }));
  const same = manager.laneFor('modelflare', 'm');
  assert.equal(same, lane, '同一 id 的车道应复用实例');
  assert.equal(same.name, '改名');
  assert.equal(same.rate.rpm, 6);
  assert.equal(same.stats.completed, 7);
});
