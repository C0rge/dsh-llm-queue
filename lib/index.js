/**
 * dsh-llm-queue — 按 provider 路由排队限速的 DSH 插件
 *
 * 拦截点：`llm/stream` 瀑布流。只对匹配到车道（lane）的 provider 生效，
 * 其它 provider 的请求原样透传，完全不经过队列。
 *
 * 超出速率预算的请求先排队，拿到槽位后才真正调用上游 —— 所以不会产生 429。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { QueueAbortError, QueueManager, normalizeConfig } from './queue.js';
import { renderPage } from './page.js';

export const name = 'llm-queue';
export const inject = ['llm'];

const DEFAULT_CONFIG = {
  enabled: true,
  logSize: 200,
  routes: [
    {
      id: 'modelflare',
      name: 'ModelFlare（低价路由）',
      providers: ['modelflare'],
      models: [],
      enabled: true,
      rate: { mode: 'spaced', rpm: 3, burst: 1, max_concurrent: 1, max_wait_seconds: 0 },
    },
  ],
};

const BRIDGE = '/api/llm-queue';
const PAGE_PATH = '/llm-queue';

/** 进程级共享状态：热重载会重建插件，但路由只注册一次，处理器始终读最新 manager。 */
function sharedState() {
  const key = '__dshLlmQueuePlugin';
  globalThis[key] ??= { manager: null, routesInstalled: false };
  return globalThis[key];
}

function stateFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, 'llm-queue', 'config.json');
}

function loadPersisted() {
  try {
    const raw = readFileSync(stateFile(), 'utf8');
    return normalizeConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persist(config) {
  const file = stateFile();
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}

function isLocalRequest(req) {
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (typeof origin === 'string') {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  const remote = req.socket?.remoteAddress ?? '';
  return (
    remote === '127.0.0.1' ||
    remote === '::1' ||
    remote === '::ffff:127.0.0.1' ||
    remote.startsWith('127.')
  );
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(html),
  });
  res.end(html);
}

async function readJsonBody(req, limit = 256 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('请求体过大');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 把一次排队 + 上游调用包装成可流式消费的生成器。 */
function wrapStream(thunk, lane, manager, options) {
  return (async function* queued() {
    const startedAt = Date.now();
    let ticket;
    try {
      ticket = await lane.acquire(options?.signal);
    } catch (error) {
      if (error instanceof QueueAbortError) return;
      manager.record({
        time: new Date().toISOString(),
        provider: options?.provider ?? '',
        model: options?.model ?? '',
        wait: null,
        state: 'timeout',
        note: String(error?.message ?? error),
      });
      throw error;
    }

    let ok = false;
    let outcome = 'completed';
    try {
      const source = thunk();
      for await (const chunk of source) {
        if (chunk?.type === 'finish') {
          const kind = chunk.reason?.kind;
          if (kind === 'error') outcome = 'error';
          else if (kind === 'aborted') outcome = 'aborted';
        }
        yield chunk;
      }
      ok = outcome === 'completed';
    } catch (error) {
      outcome = 'threw';
      manager.record({
        time: new Date().toISOString(),
        provider: options?.provider ?? '',
        model: options?.model ?? '',
        wait: Number(ticket.wait.toFixed(2)),
        state: 'threw',
        note: String(error?.message ?? error).slice(0, 300),
      });
      throw error;
    } finally {
      lane.release(ok);
      manager.record({
        time: new Date().toISOString(),
        provider: options?.provider ?? '',
        model: options?.model ?? '',
        wait: Number(ticket.wait.toFixed(2)),
        elapsed: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        state: outcome,
        note: outcome === 'completed' ? '' : outcome,
      });
    }
  })();
}

function buildRoutes(getManager, onSave) {
  const guard = (req, res) => {
    if (!isLocalRequest(req)) {
      sendJson(res, 403, { error: '只接受本机同源请求' });
      return false;
    }
    return true;
  };

  return [
    {
      kind: 'exact',
      path: PAGE_PATH,
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        sendHtml(res, renderPage());
      },
    },
    {
      kind: 'exact',
      path: `${PAGE_PATH}/`,
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        sendHtml(res, renderPage());
      },
    },
    {
      kind: 'exact',
      path: `${BRIDGE}/state`,
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        const manager = getManager();
        const snapshot = manager.snapshot();
        const configured = [...new Set(snapshot.lanes.flatMap((lane) => lane.providers))];
        const providers = Array.isArray(manager.providers) && manager.providers.length > 0
          ? manager.providers
          : configured;
        sendJson(res, 200, { ...snapshot, providers, page: PAGE_PATH });
      },
    },
    {
      kind: 'exact',
      path: `${BRIDGE}/config`,
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        if (req.method === 'GET') {
          sendJson(res, 200, getManager().config);
          return;
        }
        if (req.method !== 'PUT') {
          sendJson(res, 405, { error: `不支持的方法：${req.method}` });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const config = normalizeConfig(body);
          await onSave(config);
          sendJson(res, 200, { ok: true, config });
        } catch (error) {
          sendJson(res, 400, { error: String(error?.message ?? error) });
        }
      },
    },
    {
      kind: 'exact',
      path: `${BRIDGE}/reset`,
      handler: async (req, res) => {
        if (!guard(req, res)) return;
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: `不支持的方法：${req.method}` });
          return;
        }
        getManager().reset();
        sendJson(res, 200, { ok: true });
      },
    },
  ];
}

export function apply(ctx, config = {}) {
  let effective;
  try {
    effective = normalizeConfig(config.routes ? config : { ...DEFAULT_CONFIG, ...config });
  } catch (error) {
    ctx.logger?.warn?.(`llm-queue: 配置无效，改用默认值（${error?.message ?? error}）`);
    effective = normalizeConfig(DEFAULT_CONFIG);
  }

  const persisted = loadPersisted();
  if (persisted) effective = persisted;

  const manager = new QueueManager(effective);
  manager.config = effective;

  // 暴露可用 provider 列表给面板（内部结构，读不到就留空）
  try {
    const adapters = ctx.llm?.adapters;
    manager.providers = adapters instanceof Map ? [...adapters.keys()] : [];
  } catch {
    manager.providers = [];
  }

  const state = sharedState();
  state.manager = manager;

  ctx.on('llm/stream', (options, next) => {
    const lane = manager.laneFor(options?.provider, options?.model);
    if (!lane) return next();
    return wrapStream(next, lane, manager, options);
  });

  const save = async (next) => {
    manager.config = next;
    manager.apply(next);
    const stored = persist(next);
    if (!stored) ctx.logger?.warn?.('llm-queue: 配置写入磁盘失败，仅本进程生效');
  };

  if (!state.routesInstalled) {
    ctx.inject(['webServer'], (webCtx) => {
      const server = webCtx.get('webServer');
      if (!server) return;
      for (const route of buildRoutes(() => state.manager, save)) {
        try {
          server.register(route);
        } catch (error) {
          webCtx.logger?.warn?.(`llm-queue: 注册路由失败 ${route.path}（${error?.message ?? error}）`);
        }
      }
      state.routesInstalled = true;
      let origin = '';
      try {
        origin = server.getOrigin();
      } catch {
        origin = '';
      }
      webCtx.logger?.info?.(`llm-queue: 面板已挂载 ${origin}${PAGE_PATH}`);
    });
  }

  ctx.on('dispose', () => {
    if (state.manager === manager) state.manager = null;
  });

  const lanes = effective.routes.map((route) => `${route.id}→${route.providers.join('/')}@${route.rate.rpm}rpm`);
  ctx.logger?.info?.(`llm-queue: 已启用 ${effective.routes.length} 条车道（${lanes.join('，')}）`);
}
