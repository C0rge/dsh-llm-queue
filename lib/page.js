/**
 * page.js — 面板 HTML（单文件，无外部依赖，随插件一起由 DSH 的 web 服务托管）
 */

const STYLE = `
  :root{
    --bg:#0e1014; --panel:#161a21; --panel-2:#1c212b; --line:#242b38;
    --text:#e6e9ef; --muted:#8b93a7; --accent:#4c8dff; --ok:#38c172;
    --warn:#f0b429; --err:#ef4d5a; --field:#0f1319;
  }
  @media (prefers-color-scheme: light){
    :root{
      --bg:#f5f6f8; --panel:#ffffff; --panel-2:#f7f8fa; --line:#e2e5ea;
      --text:#1c2330; --muted:#66707f; --accent:#2f6fe4; --ok:#1f9d55;
      --warn:#b7791f; --err:#d63b4a; --field:#ffffff;
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);
    font:14px/1.55 "Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  header{display:flex;align-items:center;gap:12px;padding:16px 24px;
    border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:5}
  header h1{font-size:15px;margin:0;font-weight:600;letter-spacing:.2px}
  header .sub{font-size:12px;color:var(--muted)}
  .pill{font-size:12px;padding:3px 10px;border-radius:20px;border:1px solid var(--line);
    color:var(--muted);background:var(--panel-2);white-space:nowrap}
  .pill.ok{color:var(--ok)}
  .pill.err{color:var(--err)}
  .grow{flex:1}
  main{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px;padding:18px 24px 60px}
  @media (max-width:1080px){main{grid-template-columns:1fr}}
  section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  section h2{font-size:12px;margin:0 0 14px;color:var(--muted);font-weight:600;
    text-transform:uppercase;letter-spacing:.8px}
  .route{border:1px solid var(--line);border-radius:10px;padding:13px;margin-bottom:12px;background:var(--panel-2)}
  .route-head{display:flex;align-items:center;gap:10px;margin-bottom:11px}
  .route-head input.name{flex:1;font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:9px}
  label{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
  input,select,textarea{width:100%;background:var(--field);border:1px solid var(--line);color:var(--text);
    border-radius:7px;padding:7px 9px;font:inherit;font-size:13px;outline:none}
  input:focus,select:focus,textarea:focus{border-color:var(--accent)}
  textarea{resize:vertical;min-height:52px;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  button{font:inherit;font-size:13px;border-radius:7px;border:1px solid var(--line);
    background:var(--panel-2);color:var(--text);padding:7px 13px;cursor:pointer}
  button:hover{border-color:var(--accent)}
  button.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
  button.ghost{background:transparent}
  button.danger{color:var(--err)}
  .hint{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.65}
  code{background:var(--field);border:1px solid var(--line);border-radius:5px;padding:1px 6px;
    font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .stat{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:11px;background:var(--panel-2)}
  .stat-head{display:flex;align-items:baseline;gap:9px;margin-bottom:9px}
  .stat-head b{font-size:13px}
  .stat-head span{font-size:12px;color:var(--muted)}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(80px,1fr));gap:7px}
  .kpi{background:var(--field);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
  .kpi i{display:block;font-style:normal;font-size:11px;color:var(--muted)}
  .kpi b{font-size:16px;font-weight:600;font-variant-numeric:tabular-nums}
  .kpi.ok b{color:var(--ok)} .kpi.warn b{color:var(--warn)} .kpi.err b{color:var(--err)}
  table{width:100%;border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
  th,td{text-align:left;padding:6px 7px;border-bottom:1px solid var(--line);white-space:nowrap}
  th{color:var(--muted);font-weight:500;font-size:11px}
  td.w{color:var(--warn)} td.ok{color:var(--ok)} td.err{color:var(--err)}
  .toast{position:fixed;right:20px;bottom:20px;background:var(--panel);border:1px solid var(--line);
    border-radius:9px;padding:10px 15px;font-size:13px;opacity:0;transform:translateY(8px);
    transition:.2s;pointer-events:none;max-width:min(420px,80vw)}
  .toast.show{opacity:1;transform:none}
  .toast.err{border-color:var(--err);color:var(--err)}
`;

const SCRIPT = `
const $ = (s, r) => (r || document).querySelector(s);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const API = '/api/llm-queue';
let config = null;
let dirty = false;
let firstRender = true;

function toast(msg, kind) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (kind === 'err' ? ' err' : '');
  clearTimeout(t._h);
  t._h = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function num(value, step) {
  const i = el('input');
  i.type = 'number';
  i.step = step || '1';
  i.value = value === null || value === undefined ? '' : value;
  i.addEventListener('input', () => { dirty = true; });
  return i;
}

function text(value, placeholder) {
  const i = el('input');
  i.type = 'text';
  i.value = value || '';
  if (placeholder) i.placeholder = placeholder;
  i.addEventListener('input', () => { dirty = true; });
  return i;
}

function field(labelText, input) {
  const wrap = el('div');
  wrap.appendChild(el('label', null, labelText));
  wrap.appendChild(input);
  return wrap;
}

function renderRoutes() {
  const box = $('#routes');
  box.innerHTML = '';
  config.routes.forEach((route, index) => {
    const card = el('div', 'route');
    const head = el('div', 'route-head');

    const nameInput = text(route.name, '车道名称');
    nameInput.className = 'name';
    const enabled = el('input');
    enabled.type = 'checkbox';
    enabled.checked = route.enabled !== false;
    enabled.style.width = 'auto';
    enabled.addEventListener('change', () => { route.enabled = enabled.checked; dirty = true; });
    const enabledLabel = el('label');
    enabledLabel.style.margin = '0';
    enabledLabel.style.display = 'flex';
    enabledLabel.style.alignItems = 'center';
    enabledLabel.style.gap = '6px';
    enabledLabel.appendChild(enabled);
    enabledLabel.appendChild(document.createTextNode('启用'));
    const del = el('button', 'danger', '删除');
    del.addEventListener('click', () => {
      if (config.routes.length === 1) return toast('至少保留一条车道', 'err');
      config.routes.splice(index, 1);
      dirty = true;
      renderRoutes();
    });
    head.append(nameInput, enabledLabel, del);

    const g1 = el('div', 'grid');
    g1.style.marginBottom = '9px';
    g1.appendChild(field('Provider（逗号分隔）', text(route.providers.join(', '), 'modelflare')));
    g1.appendChild(field('限速模式', (() => {
      const s = el('select');
      [['spaced', 'spaced · 均匀间隔'], ['burst', 'burst · 令牌桶']].forEach((pair) => {
        const o = el('option', null, pair[1]);
        o.value = pair[0];
        if (route.rate.mode === pair[0]) o.selected = true;
        s.appendChild(o);
      });
      s.addEventListener('change', () => { route.rate.mode = s.value; dirty = true; });
      return s;
    })()));

    const g2 = el('div', 'grid');
    const mk = (labelText, key, step) => {
      const input = num(route.rate[key], step);
      input.addEventListener('input', () => { route.rate[key] = input.value === '' ? 0 : Number(input.value); });
      g2.appendChild(field(labelText, input));
    };
    mk('RPM（每分钟请求）', 'rpm', '1');
    mk('burst 突发数', 'burst', '1');
    mk('最大并发', 'max_concurrent', '1');
    mk('最长排队秒（0=不限）', 'max_wait_seconds', '1');

    const g3 = el('div');
    g3.style.marginTop = '9px';
    const models = el('textarea');
    models.value = (route.models || []).join(', ');
    models.placeholder = '留空 = 该 provider 下所有模型；填了就只限这些模型';
    models.addEventListener('input', () => {
      route.models = models.value.split(/[,\\s]+/).map((s) => s.trim()).filter(Boolean);
      dirty = true;
    });
    g3.appendChild(field('模型白名单（逗号分隔，可空）', models));

    card.append(head, g1, g2, g3);
    box.appendChild(card);
  });
}

function renderStats(state) {
  const box = $('#stats');
  box.innerHTML = '';
  if (!state.lanes || state.lanes.length === 0) {
    box.appendChild(el('div', 'hint', '没有车道'));
    return;
  }
  state.lanes.forEach((lane) => {
    const card = el('div', 'stat');
    const head = el('div', 'stat-head');
    head.appendChild(el('b', null, lane.name));
    head.appendChild(el('span', null, lane.providers.join(' / ')));
    if (!lane.enabled) head.appendChild(el('span', null, '· 已停用'));
    card.appendChild(head);

    const kpis = el('div', 'kpis');
    const kpi = (label, value, cls) => {
      const box2 = el('div', 'kpi' + (cls ? ' ' + cls : ''));
      box2.appendChild(el('i', null, label));
      box2.appendChild(el('b', null, String(value)));
      kpis.appendChild(box2);
    };
    kpi('队列', lane.queue_depth, lane.queue_depth > 0 ? 'warn' : '');
    kpi('在飞', lane.in_flight + '/' + lane.rate.max_concurrent);
    kpi('有效 RPM', lane.effective_rpm, 'ok');
    kpi('下次放行', lane.next_allowed_in > 0 ? lane.next_allowed_in.toFixed(1) + 's' : '就绪');
    kpi('完成', lane.stats.completed, 'ok');
    kpi('失败', lane.stats.failed, lane.stats.failed > 0 ? 'err' : '');
    card.appendChild(kpis);
    box.appendChild(card);
  });

  const table = el('table');
  const thead = el('thead');
  const hr = el('tr');
  ['时间', 'provider', '模型', '排队', '耗时', '结果'].forEach((h) => hr.appendChild(el('th', null, h)));
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = el('tbody');
  (state.log || []).slice(0, 40).forEach((item) => {
    const tr = el('tr');
    const stamp = item.time ? new Date(item.time).toLocaleTimeString('zh-CN', { hour12: false }) : '';
    tr.appendChild(el('td', null, stamp));
    tr.appendChild(el('td', null, item.provider || ''));
    tr.appendChild(el('td', null, item.model || ''));
    const wait = el('td', null, item.wait === null || item.wait === undefined ? '—' : item.wait.toFixed(2) + 's');
    if (typeof item.wait === 'number' && item.wait >= 1) wait.className = 'w';
    tr.appendChild(wait);
    tr.appendChild(el('td', null, item.elapsed === undefined ? '—' : item.elapsed.toFixed(2) + 's'));
    const stateCell = el('td', null, item.state || '');
    stateCell.className = item.state === 'completed' ? 'ok' : (item.state === 'error' || item.state === 'threw' ? 'err' : 'w');
    tr.appendChild(stateCell);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  if ((state.log || []).length === 0) {
    box.appendChild(el('div', 'hint', '还没有经过队列的请求。'));
  } else {
    const wrap = el('div');
    wrap.style.overflowX = 'auto';
    wrap.appendChild(table);
    box.appendChild(wrap);
  }
}

async function poll() {
  try {
    const res = await fetch(API + '/state', { cache: 'no-store' });
    const state = await res.json();
    $('#pill').textContent = state.enabled ? '已启用 · ' + state.lanes.length + ' 条车道' : '已停用';
    $('#pill').className = 'pill ' + (state.enabled ? 'ok' : '');
    $('#providers').textContent = state.providers && state.providers.length
      ? 'provider：' + state.providers.join(', ')
      : 'provider：（未探测到）';
    renderStats(state);
  } catch (e) {
    $('#pill').textContent = '连接失败';
    $('#pill').className = 'pill err';
  }
}

async function load() {
  const res = await fetch(API + '/config', { cache: 'no-store' });
  config = await res.json();
  renderRoutes();
  const g = $('#globalEnabled');
  g.checked = config.enabled !== false;
  firstRender = false;
}

async function save() {
  if (config && config.routes) {
    config.routes.forEach((r) => {
      if (!Array.isArray(r.providers)) {
        r.providers = String(r.providers || '').split(/[,\\s]+/).filter(Boolean);
      }
    });
  }
  try {
    const res = await fetch(API + '/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || '保存失败');
    config = out.config;
    renderRoutes();
    dirty = false;
    toast('已保存并生效');
    poll();
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
}

$('#globalEnabled').addEventListener('change', (e) => {
  config.enabled = e.target.checked;
  dirty = true;
});
$('#addRoute').addEventListener('click', () => {
  config.routes.push({
    id: 'route-' + (config.routes.length + 1),
    name: '新车道',
    providers: [],
    models: [],
    enabled: true,
    rate: { mode: 'spaced', rpm: 3, burst: 1, max_concurrent: 1, max_wait_seconds: 0 },
  });
  dirty = true;
  renderRoutes();
});
$('#save').addEventListener('click', save);
$('#reset').addEventListener('click', async () => {
  await fetch(API + '/reset', { method: 'POST' });
  toast('统计已清零');
  poll();
});

load().then(poll).catch((e) => toast(String(e.message || e), 'err'));
setInterval(poll, 1500);
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});
`;

export function renderPage() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>模型排队限速 · DSH</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>模型排队限速</h1>
  <span class="pill" id="pill">连接中…</span>
  <span class="sub" id="providers"></span>
  <span class="grow"></span>
  <label style="margin:0;display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)">
    <input type="checkbox" id="globalEnabled" style="width:auto" /> 总开关
  </label>
</header>
<main>
  <section>
    <h2>车道配置</h2>
    <div id="routes"></div>
    <div class="row" style="margin-top:2px">
      <button class="ghost" id="addRoute">+ 新增车道</button>
      <span class="grow"></span>
      <button id="reset">清零统计</button>
      <button class="primary" id="save">保存并应用</button>
    </div>
    <div class="hint">
      一条车道 = 一个（或一组）provider 的共享速率预算。只有 provider 命中的请求会排队，
      其它 provider 直连、完全不受影响。<br>
      队列在 <code>llm/stream</code> 层拦截，拿不到槽位就不发上游请求 —— 所以不会出现 429，
      代价是每个超预算的请求要多等一个间隔（3 RPM = 20 秒）。
    </div>
  </section>
  <section>
    <h2>实时状态</h2>
    <div id="stats"><div class="hint">等待数据…</div></div>
  </section>
</main>
<div class="toast" id="toast"></div>
<script>${SCRIPT}</script>
</body>
</html>`;
}
