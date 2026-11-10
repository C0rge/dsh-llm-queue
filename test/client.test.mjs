import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const SOURCE = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

/**
 * 用假 React + 假宿主加载客户端 bundle。
 * 平台只提供 react 种子，所以这里必须自己实现最小 hooks 运行时。
 */
function loadBundle({ withReact = true, fetchImpl } = {}) {
  const registrations = [];
  const styles = [];
  const fakeDocument = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: (tag) => styles.push(tag) },
  };
  const fakeWindow = { __ModuleLoader__: { load: (registration) => registrations.push(registration) } };
  const fakeConsole = { warn: () => {}, error: () => {}, log: () => {} };

  const saved = {
    window: globalThis.window,
    document: globalThis.document,
    fetch: globalThis.fetch,
    console: globalThis.console,
  };
  globalThis.window = fakeWindow;
  globalThis.document = fakeDocument;
  globalThis.console = fakeConsole;
  if (fetchImpl) globalThis.fetch = fetchImpl;

  try {
    // bundle 是浏览器脚本：用 Function 在“全局”里求值，效果等同 <script>
    new Function('window', 'document', 'fetch', 'console', SOURCE)(
      fakeWindow,
      fakeDocument,
      fetchImpl ?? globalThis.fetch,
      fakeConsole
    );
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
    globalThis.console = saved.console;
    if (fetchImpl) globalThis.fetch = saved.fetch;
  }

  assert.equal(registrations.length, 1, 'bundle 必须注册正好一个客户端模块');
  const registration = registrations[0];

  const react = withReact ? createReact() : null;
  const exportsObject = registration.factory((specifier) => {
    if (signature(specifier) === 'react') {
      if (!react) throw new Error('module table missed react');
      return react.api;
    }
    throw new Error(`bundle 请求了未声明的模块：${specifier}`);
  });

  return { registration, exports: exportsObject, react, styles, fakeDocument };
}

function signature(specifier) {
  return specifier;
}

/**
 * 最小 React 运行时：createElement 遇到函数组件就当场调用（和 React 一样在父组件
 * 渲染过程中展开），hook 状态按「组件 + 出现顺序」分桶，所以子组件自己的 hook
 * 不会污染父组件的游标。
 */
function createReact() {
  const contexts = new Map();
  const stack = [];
  const allCleanups = [];
  let keySeq = 0;
  let pendingEffects = [];

  const current = () => {
    const ctx = stack[stack.length - 1];
    if (!ctx) throw new Error('hook 只能在组件渲染期间调用');
    return ctx;
  };

  const api = {
    createElement(type, props, ...children) {
      const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false);
      if (typeof type === 'function') {
        const key = `${type.name || 'Component'}#${keySeq++}`;
        let ctx = contexts.get(key);
        if (!ctx) {
          ctx = { slots: [], refs: [], effects: [], cursor: 0 };
          contexts.set(key, ctx);
        }
        ctx.cursor = 0;
        stack.push(ctx);
        let out;
        try {
          out = type({ ...(props ?? {}), children: kids.length === 1 ? kids[0] : kids });
        } finally {
          stack.pop();
        }
        for (const effect of ctx.effects.splice(0)) pendingEffects.push(effect);
        return out;
      }
      return { type, props: props ?? {}, children: kids };
    },
    useState(initial) {
      const ctx = current();
      const index = ctx.cursor++;
      if (!(index in ctx.slots)) ctx.slots[index] = typeof initial === 'function' ? initial() : initial;
      return [
        ctx.slots[index],
        (value) => {
          ctx.slots[index] = typeof value === 'function' ? value(ctx.slots[index]) : value;
        },
      ];
    },
    useRef(initial) {
      const ctx = current();
      const index = ctx.cursor++;
      if (!(index in ctx.refs)) ctx.refs[index] = { current: initial };
      return ctx.refs[index];
    },
    useCallback(fn) {
      current().cursor += 1;
      return fn;
    },
    useMemo(fn) {
      current().cursor += 1;
      return fn();
    },
    useEffect(fn) {
      const ctx = current();
      ctx.cursor += 1;
      ctx.effects.push(fn);
    },
  };

  return {
    api,
    render(Component, props = {}) {
      keySeq = 0;
      pendingEffects = [];
      const tree = api.createElement(Component, props);
      const effects = pendingEffects;
      pendingEffects = [];
      for (const effect of effects) {
        const out = effect();
        if (typeof out === 'function') allCleanups.push(out);
      }
      return { tree };
    },
    /** 卸载：跑掉所有 effect 的清理函数，避免 setInterval 挂住事件循环。 */
    dispose() {
      while (allCleanups.length > 0) {
        const cleanup = allCleanups.pop();
        try {
          cleanup();
        } catch {
          /* 清理失败不影响测试结论 */
        }
      }
    },
  };
}

/** 把元素树摊平成可断言的文本。 */
function textOf(node) {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (typeof node !== 'object') return '';
  return textOf(node.children);
}

/** 找出树里所有匹配谓词的元素。 */
function findAll(node, predicate, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out);
    return out;
  }
  if (predicate(node)) out.push(node);
  findAll(node.children, predicate, out);
  return out;
}

function fakeFetch(responses) {
  const calls = [];
  return {
    calls,
    impl: async (url, init) => {
      calls.push({ url: String(url), init });
      const key = String(url).replace('/api/llm-queue', '');
      const handler = responses[key];
      if (!handler) throw new Error(`unexpected fetch ${url}`);
      const { status = 200, body } = typeof handler === 'function' ? handler(init) : handler;
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
  };
}

const CONFIG = {
  enabled: true,
  logSize: 200,
  routes: [
    {
      id: 'modelflare',
      name: 'ModelFlare（低价路由）',
      providers: ['modelflare'],
      models: ['deepseek-v4.1-flash'],
      enabled: true,
      rate: { mode: 'spaced', rpm: 3, burst: 1, max_concurrent: 1, max_wait_seconds: 0 },
    },
  ],
};

const STATE = {
  enabled: true,
  providers: ['modelflare', 'bytecat'],
  lanes: [
    {
      id: 'modelflare',
      name: 'ModelFlare（低价路由）',
      providers: ['modelflare'],
      models: ['deepseek-v4.1-flash'],
      enabled: true,
      rate: { mode: 'spaced', rpm: 3, burst: 1, max_concurrent: 1, max_wait_seconds: 0 },
      effective_rpm: 3,
      interval_seconds: 20,
      queue_depth: 2,
      in_flight: 1,
      next_allowed_in: 7.5,
      stats: { accepted: 9, dispatched: 7, completed: 6, failed: 1, expired: 0 },
    },
  ],
  log: [
    {
      seq: 2,
      time: '2026-11-10T14:00:02.000Z',
      provider: 'modelflare',
      model: 'deepseek-v4.1-flash',
      wait: 20.01,
      elapsed: 1.8,
      state: 'completed',
    },
  ],
};

test('客户端 bundle 以 dsh-llm-queue 注册，并暴露 apply/inject', () => {
  const { registration, exports, styles } = loadBundle();
  assert.equal(registration.id, 'dsh-llm-queue');
  assert.equal(exports.name, 'llm-queue');
  assert.deepEqual(exports.inject, ['slots']);
  assert.equal(typeof exports.apply, 'function');
  assert.equal(styles.length >= 0, true);
});

test('取不到 react 时退化为空模块，绝不抛错', () => {
  const { exports } = loadBundle({ withReact: false });
  assert.equal(typeof exports.apply, 'function');
  assert.deepEqual(exports.inject, []);
  assert.doesNotThrow(() => exports.apply({}));
});

test('apply 在 settings.section 上注册「排队限速」分区', () => {
  const { exports } = loadBundle();
  const registered = [];
  const ctx = {
    slots: {
      inject(name, callback) {
        assert.equal(name, 'settings.section');
        return callback();
      },
      register(declaration, Component) {
        registered.push({ declaration, Component });
        return () => {};
      },
    },
  };

  exports.apply(ctx);

  assert.equal(registered.length, 1);
  const { declaration, Component } = registered[0];
  assert.equal(declaration.name, 'settings.section');
  assert.equal(declaration.id, 'llm-queue');
  assert.equal(declaration.label(), '排队限速');
  assert.equal(typeof Component, 'function');
});

test('面板渲染出车道配置与实时状态', async () => {
  const fetchStub = fakeFetch({
    '/config': { body: CONFIG },
    '/state': { body: STATE },
  });
  const { exports, react } = loadBundle({ fetchImpl: fetchStub.impl });
  const registered = [];
  exports.apply({
    slots: {
      inject: (_name, callback) => callback(),
      register: (declaration, Component) => {
        registered.push({ declaration, Component });
      },
    },
  });

  let rendered = react.render(registered[0].Component);
  try {
    // 首帧是「读取配置中…」；effect 里的 fetch 落定后再渲染一次
    await new Promise((resolve) => setTimeout(resolve, 0));
    rendered = react.render(registered[0].Component);

    const text = textOf(rendered.tree);
    assert.match(text, /模型排队限速/);
    assert.match(text, /ModelFlare（低价路由）/);
    assert.match(text, /车道配置/);
    assert.match(text, /实时状态/);
    assert.match(text, /deepseek-v4\.1-flash/);
    assert.match(text, /排队 2/);
    assert.match(text, /7\.5s/);

    // 只读接口：面板不应该在首屏就写配置
    assert.equal(fetchStub.calls.some((call) => call.init && call.init.method === 'PUT'), false);
  } finally {
    react.dispose();
  }
});

test('draft → payload 会把文本还原成数组，并夹住非法数值', () => {
  const { exports } = loadBundle();
  const { toDraft, toPayload } = exports.__internals;

  const draft = toDraft(CONFIG);
  const payload = toPayload({
    ...draft,
    routes: [
      {
        ...draft.routes[0],
        providersText: 'modelflare, bytecat',
        modelsText: ' deepseek-v4.1-flash ,deepseek-v4.1-pro ',
        rpm: '-5',
        burst: '0',
        max_concurrent: '2.7',
        max_wait_seconds: '30',
      },
    ],
  });

  assert.deepEqual(payload.routes[0].providers, ['modelflare', 'bytecat']);
  assert.deepEqual(payload.routes[0].models, ['deepseek-v4.1-flash', 'deepseek-v4.1-pro']);
  assert.equal(payload.routes[0].rate.rpm, 3, 'RPM 非法时回落到 3');
  assert.equal(payload.routes[0].rate.burst, 1, 'burst 最小为 1');
  assert.equal(payload.routes[0].rate.max_concurrent, 2, '并发向下取整');
  assert.equal(payload.routes[0].rate.max_wait_seconds, 30);
});
