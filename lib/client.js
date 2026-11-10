/**
 * client.js — 浏览器端（DSH 桌面端/网页端）设置页
 *
 * 在「设置」左侧导航里注册一个独立分区「排队限速」，直接在 DSH 界面里编辑
 * 车道、限速参数并查看队列实时状态，不用再另开一个浏览器标签页。
 *
 * 形态与官方 ui-* 包一致：window.__ModuleLoader__.load({ id, factory })，
 * factory 内部是普通 CJS，require() 只能取平台种子（react）。
 * 这里只依赖 react —— 宿主模块表里唯一稳定可用的 UI 种子。
 */

(() => {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return;

  /** 面板样式只注入一次；用 DSH 自己的 CSS 变量，自动跟随明暗主题。 */
  const CSS = `
.lq-root{padding:2px 0 32px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.55}
.lq-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 0 14px;border-bottom:1px solid var(--dsw-alias-border-l2)}
.lq-title{font-size:14px;font-weight:600;letter-spacing:.2px}
.lq-sub{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.lq-spacer{flex:1 1 auto}
.lq-pill{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);white-space:nowrap;background:var(--dsw-alias-bg-layer-2)}
.lq-pill.ok{color:var(--dsw-alias-state-success-primary)}
.lq-pill.warn{color:var(--dsw-alias-state-warn-primary)}
.lq-pill.err{color:var(--dsw-alias-state-error-primary)}
.lq-cols{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-start;margin-top:16px}
.lq-col{flex:1 1 320px;min-width:270px}
.lq-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lq-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-2);padding:12px 14px;margin-bottom:12px}
.lq-card-head{display:flex;flex-direction:column;align-items:stretch;gap:8px;margin-bottom:12px}
.lq-card-head .lq-name{width:100%}
.lq-kicker{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--dsw-alias-label-tertiary);font-weight:600;margin:0 0 12px}
.lq-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.lq-field>label{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.lq-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:9px}
.lq-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:7px;padding:6px 8px;font:inherit;font-size:13px;outline:none}
.lq-input:focus{border-color:var(--dsw-alias-brand-primary)}
.lq-mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}
.lq-btn{font:inherit;font-size:12px;padding:5px 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.lq-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.lq-btn.primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:600}
.lq-btn.primary:hover{opacity:.9}
.lq-btn.ghost{background:transparent}
.lq-btn.danger{color:var(--dsw-alias-state-error-primary)}
.lq-btn.sm{font-size:11.5px;padding:3px 9px}
.lq-btn:disabled{opacity:.5;cursor:not-allowed}
.lq-stat-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:11px}
.lq-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.lq-check input{accent-color:var(--dsw-alias-brand-primary);margin:0}
.lq-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));gap:7px;margin-bottom:10px}
.lq-kpi{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:6px 8px}
.lq-kpi i{display:block;font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary)}
.lq-kpi b{font-size:15px;font-weight:600;font-variant-numeric:tabular-nums}
.lq-kpi.ok b{color:var(--dsw-alias-state-success-primary)}
.lq-kpi.warn b{color:var(--dsw-alias-state-warn-primary)}
.lq-kpi.err b{color:var(--dsw-alias-state-error-primary)}
.lq-table{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}
.lq-table th{text-align:left;font-weight:500;color:var(--dsw-alias-label-tertiary);padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap}
.lq-table td{padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-l1);white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.lq-table td.ok{color:var(--dsw-alias-state-success-primary)}
.lq-table td.bad{color:var(--dsw-alias-state-error-primary)}
.lq-table td.warn{color:var(--dsw-alias-state-warn-primary)}
.lq-scroll{overflow:auto;max-height:260px}
.lq-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:10px;line-height:1.7}
.lq-hint code{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:4px;padding:0 4px;font-family:ui-monospace,Consolas,monospace;font-size:11px}
.lq-warnbox{font-size:11.5px;color:var(--dsw-alias-state-warn-primary);margin-top:6px}
.lq-errbox{border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);border-radius:8px;padding:8px 11px;font-size:12px;margin-top:12px}
.lq-toast{position:sticky;bottom:0;margin-top:12px;font-size:12px;color:var(--dsw-alias-state-success-primary)}
.lq-toast.err{color:var(--dsw-alias-state-error-primary)}
.lq-empty{font-size:12px;color:var(--dsw-alias-label-tertiary);padding:6px 0}
`;

  const STYLE_ID = 'dsh-llm-queue/panel.css';

  function ensureStyle() {
    try {
      if (typeof document === 'undefined') return;
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)) return;
      const tag = document.createElement('style');
      tag.dataset.plugin = 'dsh-llm-queue';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    } catch {
      /* 样式注入失败不影响功能 */
    }
  }

  window.__ModuleLoader__.load({
    id: 'dsh-llm-queue',
    factory: (require) => {
      const module = { exports: {} };
      const exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

      /**
       * 平台种子解析必须容错：宿主不隔离 factory，一个抛错会连带整个 web
       * 界面加载失败。取不到 react 就退化成空模块，插件不可见但 DSH 正常。
       */
      let React = null;
      try {
        React = require('react');
      } catch (error) {
        React = null;
        try {
          console.warn('[llm-queue] 取不到 react 种子，面板已禁用：', error && error.message);
        } catch {
          /* 控制台不可用 */
        }
      }

      exports.name = 'llm-queue';
      exports.inject = React ? ['slots'] : [];

      if (!React) {
        exports.apply = () => {};
        return module.exports;
      }

      ensureStyle();

      const h = React.createElement;
      const { useCallback, useEffect, useMemo, useRef, useState } = React;
      const API = '/api/llm-queue';

      // ── 数据层 ──────────────────────────────────────────────────────────
      async function api(path, init) {
        const res = await fetch(API + path, { cache: 'no-store', ...init });
        let data = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }
        if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
        return data || {};
      }

      const splitList = (text) =>
        String(text || '')
          .split(/[,\s]+/)
          .map((item) => item.trim())
          .filter(Boolean);

      const intOr = (value, fallback, min) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < min) return fallback;
        return Math.trunc(parsed);
      };

      const numOr = (value, fallback, min) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < min) return fallback;
        return parsed;
      };

      /** 服务端配置 → 表单草稿。providers/models 保留成原文，避免边打字边被拆分。 */
      function toDraft(config) {
        const routes = Array.isArray(config && config.routes) ? config.routes : [];
        return {
          enabled: !config || config.enabled !== false,
          routes: routes.map((route) => {
            const rate = (route && route.rate) || {};
            return {
              id: String((route && route.id) || ''),
              name: String((route && route.name) || (route && route.id) || ''),
              enabled: !route || route.enabled !== false,
              providersText: ((route && route.providers) || []).join(', '),
              modelsText: ((route && route.models) || []).join(', '),
              mode: rate.mode === 'burst' ? 'burst' : 'spaced',
              rpm: rate.rpm ?? 3,
              burst: rate.burst ?? 1,
              max_concurrent: rate.max_concurrent ?? 1,
              max_wait_seconds: rate.max_wait_seconds ?? 0,
            };
          }),
        };
      }

      /** 表单草稿 → 提交给服务端的 payload。 */
      function toPayload(draft) {
        return {
          enabled: draft.enabled !== false,
          routes: draft.routes.map((route) => ({
            id: route.id,
            name: route.name,
            enabled: route.enabled !== false,
            providers: splitList(route.providersText),
            models: splitList(route.modelsText),
            rate: {
              mode: route.mode,
              rpm: numOr(route.rpm, 3, 0),
              burst: intOr(route.burst, 1, 1),
              max_concurrent: intOr(route.max_concurrent, 1, 1),
              max_wait_seconds: numOr(route.max_wait_seconds, 0, 0),
            },
          })),
        };
      }

      // ── 小组件 ──────────────────────────────────────────────────────────
      function Field(props) {
        return h('div', { className: 'lq-field' }, h('label', null, props.label), props.children);
      }

      function TextInput(props) {
        return h('input', {
          className: 'lq-input' + (props.mono ? ' lq-mono' : ''),
          type: 'text',
          value: props.value,
          placeholder: props.placeholder,
          spellCheck: false,
          onChange: (event) => props.onChange(event.target.value),
        });
      }

      function NumberInput(props) {
        return h('input', {
          className: 'lq-input',
          type: 'number',
          min: props.min,
          step: props.step || 1,
          value: String(props.value ?? ''),
          onChange: (event) => props.onChange(event.target.value),
        });
      }

      function Kpi(props) {
        return h(
          'div',
          { className: 'lq-kpi' + (props.tone ? ' ' + props.tone : '') },
          h('i', null, props.label),
          h('b', null, String(props.value))
        );
      }

      // ── 车道编辑卡 ──────────────────────────────────────────────────────
      function LaneEditor(props) {
        const route = props.route;
        const known = props.knownProviders;
        const patch = (fields) => props.onChange({ ...route, ...fields });
        const patchRate = (fields) => props.onChange({ ...route, ...fields });

        const providers = splitList(route.providersText);
        const unknown = known.length > 0 ? providers.filter((name) => !known.includes(name)) : [];

        return h(
          'div',
          { className: 'lq-card' },
          h(
            'div',
            { className: 'lq-card-head' },
            h(TextInput, {
              value: route.name,
              placeholder: '车道名称',
              onChange: (value) => patch({ name: value }),
            }),
            h(
              'div',
              { className: 'lq-row' },
              h(
                'label',
                { className: 'lq-check', title: '关闭后这条车道的请求不再排队，直接透传' },
                h('input', {
                  type: 'checkbox',
                  checked: route.enabled !== false,
                  onChange: (event) => patch({ enabled: event.target.checked }),
                }),
                '启用'
              ),
              h('span', { className: 'lq-spacer' }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'lq-btn danger sm',
                  disabled: props.canDelete === false,
                  title: props.canDelete === false ? '至少保留一条车道' : '删除这条车道',
                  onClick: props.onRemove,
                },
                '删除'
              )
            )
          ),
          h(
            'div',
            { className: 'lq-grid' },
            h(
              Field,
              { label: 'provider（逗号分隔）' },
              h(TextInput, {
                value: route.providersText,
                mono: true,
                placeholder: 'modelflare',
                onChange: (value) => patch({ providersText: value }),
              })
            ),
            h(
              Field,
              { label: '限速模式' },
              h(
                'select',
                {
                  className: 'lq-input',
                  value: route.mode,
                  onChange: (event) => patch({ mode: event.target.value }),
                },
                h('option', { value: 'spaced' }, 'spaced · 均匀间隔'),
                h('option', { value: 'burst' }, 'burst · 令牌桶')
              )
            )
          ),
          unknown.length > 0
            ? h(
                'div',
                { className: 'lq-warnbox' },
                `未在已安装 provider 中找到：${unknown.join(', ')}（可能是拼写错误，或该 provider 已被移除）`
              )
            : null,
          h(
            'div',
            { className: 'lq-grid', style: { marginTop: '9px' } },
            h(
              Field,
              { label: 'RPM 每分钟请求' },
              h(NumberInput, {
                value: route.rpm,
                min: 0,
                onChange: (value) => patchRate({ rpm: value }),
              })
            ),
            h(
              Field,
              { label: 'burst 突发数' },
              h(NumberInput, {
                value: route.burst,
                min: 1,
                onChange: (value) => patchRate({ burst: value }),
              })
            ),
            h(
              Field,
              { label: '最大并发' },
              h(NumberInput, {
                value: route.max_concurrent,
                min: 1,
                onChange: (value) => patchRate({ max_concurrent: value }),
              })
            ),
            h(
              Field,
              { label: '最长排队秒（0=不限）' },
              h(NumberInput, {
                value: route.max_wait_seconds,
                min: 0,
                onChange: (value) => patchRate({ max_wait_seconds: value }),
              })
            )
          ),
          h(
            'div',
            { className: 'lq-grid', style: { marginTop: '9px', gridTemplateColumns: 'minmax(0,1fr)' } },
            h(
              Field,
              { label: '模型白名单（逗号分隔，留空 = 该 provider 下全部模型）' },
              h(TextInput, {
                value: route.modelsText,
                mono: true,
                placeholder: 'deepseek-v4.1-flash, deepseek-v4.1-pro',
                onChange: (value) => patch({ modelsText: value }),
              })
            )
          ),
          h('div', { className: 'lq-hint' }, `车道 id：${route.id || '（未命名）'} · 同一车道内所有模型共享上面的速率预算`)
        );
      }

      // ── 实时状态 ────────────────────────────────────────────────────────
      function LaneStatus(props) {
        const lane = props.lane;
        const ready = !lane.next_allowed_in || lane.next_allowed_in <= 0;
        return h(
          'div',
          { className: 'lq-card' },
          h(
            'div',
            { className: 'lq-stat-head' },
            h('b', { style: { fontSize: '12.5px' } }, lane.name || lane.id),
            h('span', { className: 'lq-sub' }, (lane.providers || []).join(' / ')),
            lane.enabled === false ? h('span', { className: 'lq-pill' }, '已停用') : null
          ),
          h(
            'div',
            { className: 'lq-kpis' },
            h(Kpi, {
              label: '队列',
              value: lane.queue_depth,
              tone: lane.queue_depth > 0 ? 'warn' : '',
            }),
            h(Kpi, { label: '在飞', value: `${lane.in_flight}/${lane.rate.max_concurrent}` }),
            h(Kpi, { label: '有效 RPM', value: lane.effective_rpm, tone: 'ok' }),
            h(Kpi, {
              label: '下次放行',
              value: ready ? '就绪' : `${lane.next_allowed_in.toFixed(1)}s`,
              tone: ready ? '' : 'warn',
            }),
            h(Kpi, { label: '完成', value: lane.stats.completed, tone: 'ok' }),
            h(Kpi, {
              label: '失败',
              value: lane.stats.failed,
              tone: lane.stats.failed > 0 ? 'err' : '',
            })
          ),
          h(
            'div',
            { className: 'lq-sub' },
            `间隔 ${lane.interval_seconds}s · 已入队 ${lane.stats.accepted} · 已放行 ${lane.stats.dispatched}` +
              (lane.stats.expired ? ` · 排队超时 ${lane.stats.expired}` : '')
          )
        );
      }

      function LogTable(props) {
        const rows = props.log || [];
        if (rows.length === 0) return h('div', { className: 'lq-empty' }, '还没有经过队列的请求。');
        return h(
          'div',
          { className: 'lq-scroll' },
          h(
            'table',
            { className: 'lq-table' },
            h(
              'thead',
              null,
              h(
                'tr',
                null,
                ['时间', 'provider', '模型', '排队', '耗时', '结果'].map((title) =>
                  h('th', { key: title }, title)
                )
              )
            ),
            h(
              'tbody',
              null,
              rows.slice(0, 50).map((item) =>
                h(
                  'tr',
                  { key: item.seq },
                  h('td', null, formatTime(item.time)),
                  h('td', null, item.provider || ''),
                  h('td', null, item.model || ''),
                  h(
                    'td',
                    { className: typeof item.wait === 'number' && item.wait >= 1 ? 'warn' : '' },
                    item.wait === null || item.wait === undefined ? '—' : `${item.wait.toFixed(2)}s`
                  ),
                  h('td', null, item.elapsed === undefined ? '—' : `${item.elapsed.toFixed(2)}s`),
                  h(
                    'td',
                    {
                      className:
                        item.state === 'completed'
                          ? 'ok'
                          : item.state === 'error' || item.state === 'threw'
                            ? 'bad'
                            : 'warn',
                    },
                    item.state || ''
                  )
                )
              )
            )
          )
        );
      }

      function formatTime(value) {
        if (!value) return '';
        try {
          return new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
        } catch {
          return '';
        }
      }

      // ── 主面板 ──────────────────────────────────────────────────────────
      function QueuePanel() {
        const [draft, setDraft] = useState(null);
        const [snapshot, setSnapshot] = useState(null);
        const [error, setError] = useState('');
        const [notice, setNotice] = useState('');
        const [saving, setSaving] = useState(false);
        const [online, setOnline] = useState(true);
        const dirty = useRef(false);

        const markDirty = useCallback(() => {
          dirty.current = true;
        }, []);

        useEffect(() => {
          let alive = true;
          api('/config')
            .then((config) => {
              if (alive) setDraft(toDraft(config));
            })
            .catch((err) => {
              if (alive) setError(`读取配置失败：${err.message}`);
            });
          return () => {
            alive = false;
          };
        }, []);

        useEffect(() => {
          let alive = true;
          let timer = null;
          const tick = async () => {
            try {
              const next = await api('/state');
              if (!alive) return;
              setSnapshot(next);
              setOnline(true);
            } catch {
              if (alive) setOnline(false);
            }
          };
          tick();
          timer = setInterval(tick, 1200);
          return () => {
            alive = false;
            if (timer) clearInterval(timer);
          };
        }, []);

        const updateRoute = useCallback(
          (index, next) => {
            markDirty();
            setDraft((current) => {
              if (!current) return current;
              const routes = current.routes.slice();
              routes[index] = next;
              return { ...current, routes };
            });
          },
          [markDirty]
        );

        const removeRoute = useCallback(
          (index) => {
            markDirty();
            setDraft((current) => {
              if (!current || current.routes.length <= 1) return current;
              const routes = current.routes.slice();
              routes.splice(index, 1);
              return { ...current, routes };
            });
          },
          [markDirty]
        );

        const addRoute = useCallback(() => {
          markDirty();
          setDraft((current) => {
            if (!current) return current;
            const used = new Set(current.routes.map((route) => route.id));
            let seq = current.routes.length + 1;
            while (used.has(`route-${seq}`)) seq += 1;
            return {
              ...current,
              routes: [
                ...current.routes,
                {
                  id: `route-${seq}`,
                  name: `新车道 ${seq}`,
                  enabled: true,
                  providersText: '',
                  modelsText: '',
                  mode: 'spaced',
                  rpm: 3,
                  burst: 1,
                  max_concurrent: 1,
                  max_wait_seconds: 0,
                },
              ],
            };
          });
        }, [markDirty]);

        const save = useCallback(async () => {
          if (!draft) return;
          setSaving(true);
          setError('');
          setNotice('');
          try {
            const result = await api('/config', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(toPayload(draft)),
            });
            setDraft(toDraft(result.config || toPayload(draft)));
            dirty.current = false;
            setNotice('已保存并立即生效');
          } catch (err) {
            setError(`保存失败：${err.message}`);
          } finally {
            setSaving(false);
          }
        }, [draft]);

        const resetStats = useCallback(async () => {
          try {
            await api('/reset', { method: 'POST' });
            setNotice('统计已清零');
          } catch (err) {
            setError(`清零失败：${err.message}`);
          }
        }, []);

        const knownProviders = useMemo(() => {
          const list = (snapshot && snapshot.providers) || [];
          return Array.isArray(list) ? list : [];
        }, [snapshot]);

        const lanes = (snapshot && snapshot.lanes) || [];
        const enabledLanes = lanes.filter((lane) => lane.enabled !== false).length;
        const totalQueued = lanes.reduce((sum, lane) => sum + (lane.queue_depth || 0), 0);

        const header = h(
          'div',
          { className: 'lq-toolbar' },
          h('span', { className: 'lq-title' }, '模型排队限速'),
          h(
            'span',
            { className: 'lq-pill' + (!online ? ' err' : snapshot && snapshot.enabled === false ? ' warn' : ' ok') },
            !online
              ? '连接失败'
              : snapshot && snapshot.enabled === false
                ? '总开关已关闭'
                : `运行中 · ${enabledLanes} 条车道生效`
          ),
          totalQueued > 0 ? h('span', { className: 'lq-pill warn' }, `排队 ${totalQueued}`) : null,
          h('span', { className: 'lq-spacer' }),
          draft
            ? h(
                'label',
                { className: 'lq-check', title: '关闭后所有车道立即停用，请求直接透传' },
                h('input', {
                  type: 'checkbox',
                  checked: draft.enabled !== false,
                  onChange: (event) => {
                    markDirty();
                    setDraft({ ...draft, enabled: event.target.checked });
                  },
                }),
                '总开关'
              )
            : null,
          h(
            'button',
            { type: 'button', className: 'lq-btn ghost', onClick: resetStats, title: '只清零计数，不改配置' },
            '清零统计'
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'lq-btn primary',
              disabled: saving || !draft,
              onClick: save,
            },
            saving ? '保存中…' : '保存并应用'
          )
        );

        if (error) {
          return h(
            'div',
            { className: 'lq-root' },
            header,
            h('div', { className: 'lq-errbox' }, error),
            h(
              'div',
              { className: 'lq-hint' },
              '面板通过 DSH 自带的 web 服务访问 /api/llm-queue；确认插件已在当前档案里启用，且请求来自本机。'
            )
          );
        }

        if (!draft) {
          return h('div', { className: 'lq-root' }, header, h('div', { className: 'lq-empty' }, '读取配置中…'));
        }

        const providerHint =
          knownProviders.length > 0
            ? `已安装 provider：${knownProviders.join('、')}`
            : '未探测到 provider 列表（不影响已配置的车道生效）';

        return h(
          'div',
          { className: 'lq-root' },
          header,
          h('div', { className: 'lq-sub', style: { marginTop: '10px' } }, providerHint),
          h(
            'div',
            { className: 'lq-cols' },
            h(
              'div',
              { className: 'lq-col' },
              h('p', { className: 'lq-kicker' }, '车道配置'),
              draft.routes.map((route, index) =>
                h(LaneEditor, {
                  key: route.id || `idx-${index}`,
                  route,
                  knownProviders,
                  canDelete: draft.routes.length > 1,
                  onChange: (next) => updateRoute(index, next),
                  onRemove: () => removeRoute(index),
                })
              ),
              h(
                'button',
                { type: 'button', className: 'lq-btn ghost', onClick: addRoute },
                '+ 新增车道'
              ),
              h(
                'div',
                { className: 'lq-hint' },
                '一条车道 = 一个（或一组）provider 的共享速率预算。只有 provider 命中的请求排队，',
                '其它 provider 直连、完全不受影响。',
                h('br'),
                '队列在 ',
                h('code', null, 'llm/stream'),
                ' 层拦截：拿不到槽位就不发上游请求，所以不会出现 429，代价是超预算的请求要多等一个间隔（',
                h('code', null, '3 RPM'),
                ' = 20 秒）。'
              )
            ),
            h(
              'div',
              { className: 'lq-col' },
              h('p', { className: 'lq-kicker' }, '实时状态'),
              lanes.length === 0
                ? h('div', { className: 'lq-empty' }, '还没有生效中的车道。')
                : lanes.map((lane) => h(LaneStatus, { key: lane.id, lane })),
              h(
                'div',
                { className: 'lq-card' },
                h('p', { className: 'lq-kicker', style: { marginBottom: '8px' } }, '最近请求'),
                h(LogTable, { log: (snapshot && snapshot.log) || [] })
              )
            )
          ),
          notice ? h('div', { className: 'lq-toast' }, notice) : null
        );
      }

      // ── 注册到设置导航 ──────────────────────────────────────────────────
      exports.apply = (ctx) => {
        try {
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              {
                name: 'settings.section',
                id: 'llm-queue',
                order: 45,
                label: () => '排队限速',
              },
              QueuePanel
            )
          );
        } catch (error) {
          try {
            console.warn('[llm-queue] 注册设置分区失败：', error && error.message);
          } catch {
            /* 控制台不可用 */
          }
        }
      };

      // 供测试/诊断读取，不影响运行时
      exports.__internals = { toDraft, toPayload, splitList, QueuePanel };

      return module.exports;
    },
  });
})();
