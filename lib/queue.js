/**
 * queue.js — 排队限速核心（零依赖，纯内存）
 *
 * 一条「车道」（Lane）对应一个 provider 路由：同一车道下的所有模型共享一个
 * 速率预算。超出预算的请求进入 FIFO 队列等待，而不是直接返回 429。
 */

const clock = () => performance.now() / 1000;

export const DEFAULT_RATE = {
  mode: 'spaced',
  rpm: 3,
  burst: 1,
  max_concurrent: 1,
  max_wait_seconds: 0,
};

export class QueueAbortError extends Error {
  constructor(message = '排队期间请求被取消') {
    super(message);
    this.name = 'QueueAbortError';
    this.code = 'ABORTED';
  }
}

export class QueueTimeoutError extends Error {
  constructor(waitedSeconds, limitSeconds) {
    super(`排队 ${waitedSeconds.toFixed(1)}s 仍未获得放行，超过 max_wait_seconds=${limitSeconds}`);
    this.name = 'QueueTimeoutError';
    this.code = 'QUEUE_TIMEOUT';
  }
}

/** 把任意输入归一化成一份可用的速率配置。 */
export function normalizeRate(raw = {}) {
  const num = (value, fallback, min) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min) return fallback;
    return parsed;
  };
  return {
    mode: raw.mode === 'burst' ? 'burst' : 'spaced',
    rpm: num(raw.rpm, DEFAULT_RATE.rpm, 0),
    burst: Math.max(1, Math.trunc(num(raw.burst, DEFAULT_RATE.burst, 1))),
    max_concurrent: Math.max(1, Math.trunc(num(raw.max_concurrent, DEFAULT_RATE.max_concurrent, 1))),
    max_wait_seconds: num(raw.max_wait_seconds, DEFAULT_RATE.max_wait_seconds, 0),
  };
}

/** 把任意输入归一化成一份可用的路由配置。 */
export function normalizeRoute(raw = {}, index = 0) {
  const id = String(raw.id ?? '').trim() || `route-${index + 1}`;
  const providers = Array.isArray(raw.providers)
    ? raw.providers.map((item) => String(item).trim()).filter(Boolean)
    : String(raw.providers ?? '')
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  const models = Array.isArray(raw.models)
    ? raw.models.map((item) => String(item).trim()).filter(Boolean)
    : String(raw.models ?? '')
        .split(/[,\s]+/)
        .map((item) => item.trim())
        .filter(Boolean);
  return {
    id,
    name: String(raw.name ?? '').trim() || id,
    providers,
    models,
    enabled: raw.enabled !== false,
    rate: normalizeRate(raw.rate),
  };
}

/** 校验前端提交的整份配置；非法输入抛错，不静默兜底。 */
export function normalizeConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('配置必须是 JSON 对象');
  }
  const routesIn = Array.isArray(raw.routes) ? raw.routes : [];
  const routes = routesIn.map((item, index) => {
    if (item === null || typeof item !== 'object') throw new Error(`第 ${index + 1} 条路由格式不正确`);
    const route = normalizeRoute(item, index);
    if (route.providers.length === 0) throw new Error(`路由「${route.name}」至少要填一个 provider`);
    return route;
  });
  const seen = new Set();
  for (const route of routes) {
    if (seen.has(route.id)) throw new Error(`路由 id 重复：${route.id}`);
    seen.add(route.id);
  }
  return {
    enabled: raw.enabled !== false,
    logSize: Math.min(1000, Math.max(20, Math.trunc(Number(raw.logSize) || 200))),
    routes,
  };
}

/** 一条车道：FIFO 队列 + 均匀/脉冲两种放行节奏。 */
export class Lane {
  constructor(route, logSize = 200) {
    this.id = route.id;
    this.logSize = logSize;
    this.waiters = [];
    this.inFlight = 0;
    this.nextAllowed = 0;
    this.tokens = route.rate.burst;
    this.lastRefill = clock();
    this.timer = null;
    this.stats = { accepted: 0, dispatched: 0, completed: 0, failed: 0, expired: 0 };
    this.apply(route);
  }

  /** 热更新路由配置（不清空队列）。 */
  apply(route) {
    this.name = route.name;
    this.providers = [...route.providers];
    this.models = [...route.models];
    this.enabled = route.enabled;
    this.rate = route.rate;
    if (this.rate.mode === 'burst') this.tokens = Math.min(this.rate.burst, Math.max(this.tokens, 0));
  }

  interval() {
    const { rpm } = this.rate;
    return rpm > 0 ? 60 / rpm : 0;
  }

  canAdmit(at) {
    const interval = this.interval();
    const maxConcurrent = this.rate.max_concurrent;
    if (interval <= 0) return this.inFlight < maxConcurrent;
    if (this.rate.mode === 'burst') {
      this.tokens = Math.min(this.rate.burst, this.tokens + (at - this.lastRefill) / interval);
      this.lastRefill = at;
      return this.tokens >= 1 && this.inFlight < maxConcurrent;
    }
    return at >= this.nextAllowed && this.inFlight < maxConcurrent;
  }

  consume(at) {
    if (this.rate.mode === 'burst') {
      this.tokens = Math.max(0, this.tokens - 1);
      this.lastRefill = at;
      return;
    }
    this.nextAllowed = at + this.interval();
  }

  /** 下次可能需要唤醒的时间（秒），用于安排定时器。 */
  nextWakeIn() {
    const interval = this.interval();
    if (interval <= 0) return 0.02;
    if (this.rate.mode === 'burst') {
      const need = Math.max(0, 1 - this.tokens) * interval;
      return Math.min(0.25, Math.max(0.005, need));
    }
    return Math.min(0.25, Math.max(0.005, this.nextAllowed - clock()));
  }

  /** 申请一个放行槽位；返回 { wait, grantedAt }。 */
  acquire(signal) {
    if (signal?.aborted) return Promise.reject(new QueueAbortError('请求在入队前已取消'));
    this.stats.accepted += 1;
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        enqueuedAt: clock(),
        settled: false,
        onAbort: null,
        timer: null,
        signal,
      };
      const settle = (fn, value) => {
        if (waiter.settled) return;
        waiter.settled = true;
        if (waiter.timer) clearTimeout(waiter.timer);
        if (signal && waiter.onAbort) signal.removeEventListener('abort', waiter.onAbort);
        fn(value);
      };
      waiter.settle = settle;
      if (signal) {
        waiter.onAbort = () => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          settle(reject, new QueueAbortError());
          this.pump();
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }
      const limit = Number(this.rate.max_wait_seconds) || 0;
      if (limit > 0) {
        waiter.timer = setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          this.stats.expired += 1;
          settle(reject, new QueueTimeoutError(clock() - waiter.enqueuedAt, limit));
          this.pump();
        }, limit * 1000);
      }
      this.waiters.push(waiter);
      this.pump();
    });
  }

  /** 放行尽可能多的等待者。 */
  pump() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.waiters.length > 0) {
      const at = clock();
      if (!this.canAdmit(at)) break;
      const waiter = this.waiters.shift();
      if (waiter.settled) continue;
      this.consume(at);
      this.inFlight += 1;
      this.stats.dispatched += 1;
      waiter.settle(waiter.resolve, { wait: at - waiter.enqueuedAt, grantedAt: at });
    }
    if (this.waiters.length > 0) {
      const delay = Math.max(5, Math.round(this.nextWakeIn() * 1000));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.pump();
      }, delay);
    }
  }

  /** 归还槽位。ok=false 记为失败，便于在面板上区分。 */
  release(ok) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (ok) this.stats.completed += 1;
    else this.stats.failed += 1;
    this.pump();
  }

  snapshot() {
    const interval = this.interval();
    const now = clock();
    return {
      id: this.id,
      name: this.name,
      providers: this.providers,
      models: this.models,
      enabled: this.enabled,
      rate: this.rate,
      effective_rpm: interval > 0 ? Number((60 / interval).toFixed(2)) : 0,
      interval_seconds: Number(interval.toFixed(3)),
      queue_depth: this.waiters.filter((waiter) => !waiter.settled).length,
      in_flight: this.inFlight,
      next_allowed_in: interval > 0 ? Number(Math.max(0, this.nextAllowed - now).toFixed(2)) : 0,
      stats: { ...this.stats },
    };
  }

  resetStats() {
    for (const key of Object.keys(this.stats)) this.stats[key] = 0;
  }
}

/** 一次模型请求的记录，供面板展示。 */
export class RequestLog {
  constructor(size = 200) {
    this.size = size;
    this.items = [];
    this.seq = 0;
  }

  push(record) {
    this.seq += 1;
    this.items.unshift({ seq: this.seq, ...record });
    if (this.items.length > this.size) this.items.length = this.size;
  }

  list(limit = 60) {
    return this.items.slice(0, limit);
  }

  clear() {
    this.items.length = 0;
  }
}

/** 多条车道的容器：按 provider + model 选路。 */
export class QueueManager {
  constructor(config = {}) {
    this.lanes = new Map();
    this.log = new RequestLog(config.logSize ?? 200);
    this.enabled = config.enabled !== false;
    this.apply(config);
  }

  apply(config = {}) {
    this.enabled = config.enabled !== false;
    const logSize = config.logSize ?? 200;
    if (this.log.size !== logSize) {
      this.log.size = logSize;
      if (this.log.items.length > logSize) this.log.items.length = logSize;
    }
    const seen = new Set();
    for (const route of config.routes ?? []) {
      seen.add(route.id);
      const existing = this.lanes.get(route.id);
      if (existing) existing.apply(route);
      else this.lanes.set(route.id, new Lane(route, logSize));
    }
    for (const id of [...this.lanes.keys()]) {
      if (!seen.has(id) && this.lanes.get(id).inFlight === 0) this.lanes.delete(id);
    }
  }

  /** 找到该请求所属的车道；没有匹配说明这条路由不该被限速。 */
  laneFor(provider, model) {
    if (!this.enabled) return null;
    for (const lane of this.lanes.values()) {
      if (!lane.enabled) continue;
      if (!lane.providers.includes(provider)) continue;
      if (lane.models.length > 0 && !lane.models.includes(model)) continue;
      return lane;
    }
    return null;
  }

  record(entry) {
    this.log.push(entry);
  }

  snapshot() {
    return {
      enabled: this.enabled,
      lanes: [...this.lanes.values()].map((lane) => lane.snapshot()),
      log: this.log.list(),
    };
  }

  reset() {
    for (const lane of this.lanes.values()) lane.resetStats();
    this.log.clear();
  }
}
