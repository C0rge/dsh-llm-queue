# dsh-llm-queue

给 DeepSeek Harness 用的**按 provider 排队限速插件**：超出速率预算的模型请求先排队，拿到槽位才真正发往上游 —— 不会返回 429，也不需要再跑一个本地 HTTP 代理。

- 只影响你指定的 provider，其它 provider 原样直连（零改动）
- **桌面端原生设置页**：DSH 设置 → 排队限速，直接在界面里改参数、看队列深度 / 在飞数 / 每条请求的排队时长
- 另有一个独立的单页面板（浏览器标签），作为设置页不可用时的备用入口
- 零依赖，只用 Node 内置模块

## 为什么是插件而不是代理

DSH 的模型调用统一走 `ctx.llm.stream()`，而它在派发前会经过 `llm/stream` 瀑布流：

```js
// @deepseek-ai/dsh-llm
streamWithRegistration(options, prepared) {
  return this.ctx.waterfall(this, "llm/stream", options, () => this.adapterStream(options, prepared));
}
```

插件挂一个 `llm/stream` 监听器，`options.provider` 命中车道时返回一个「先排队、再调用 `next()`」的异步生成器：

- `next()` 是在**拿到槽位之后**才调用的，所以排队期间不会占用上游连接、更不会打出 429
- 没有命中车道的请求直接 `next()`，行为和没装插件完全一致
- 流式 chunk 原样透传，不做缓冲；`finally` 里归还槽位，上游抛错也不会卡死队列

## 安装

```bash
git clone https://github.com/C0rge/dsh-llm-queue.git
cd dsh-llm-queue

node install.mjs --profile desktop      # 预演加 --dry-run
node uninstall.mjs --profile desktop    # 撤销（加 --purge-config 连面板配置一起删）
```

`--profile` 默认就是 `desktop`；`DSH_HOME` 默认 `~/.dsh`，装在别处的话先设置这个环境变量。

安装做三件事：

1. `<profile>/node_modules/dsh-llm-queue` 建 junction 指向本目录（源码改动即时生效）
2. profile 的 `package.json` 登记 `"dsh-llm-queue": "link:..."`（改动前的原件备份为 `package.json.bak-llm-queue`）
3. 追加到 `dsh.profile.bundles`，让它的 `cordis.patch.yml` 参与组合

**必须完全退出并重启 DSH** 才会加载（客户端页面在启动时参与组合，重启前看不到）。

## 桌面端设置页

重启后：**设置（左下角「更多」）→ 排队限速**。

它走 DSH 自己的客户端插件机制（`window.__ModuleLoader__` + `ctx.slots.register("settings.section")`），所以是设置弹窗里的一个真实页面，不是外部网页：

| 组成 | 说明 |
|---|---|
| `lib/client.js` | 浏览器端 bundle，注册 `settings.section`（`id: llm-queue`, `order: 45`），只依赖平台种子 `react` |
| `lib/page.js` | 备用单页面板的 HTML（同一个 `/api/llm-queue`） |
| `dsh.client`（package.json） | `{ platform: "web", immediately: true, inject: ["@deepseek-ai/dsh-client-ui-settings"] }` |
| `exports["./client"]` | 指向 `lib/client.js`，客户端模块系统据此下发 bundle |

页面内容：总开关、车道卡片（名称 / 启用 / 删除 / provider / 模式 / RPM / burst / 并发 / 最长排队 / 模型白名单）、实时状态（队列、在飞、有效 RPM、下次放行倒计时、完成/失败）、最近请求表。参数改动点「保存并应用」即时生效，无需重启。

布局是 `flex-wrap` 自适应：宽屏左右两栏，窄弹窗自动堆叠成单列。

## 备用面板（浏览器标签）

```bash
node open-panel.mjs         # 自动找到 DSH 的本地端口并打开浏览器
node open-panel.mjs --print  # 只打印地址
```

桌面端 Web 服务端口每次启动可能不同，`open-panel.mjs` 会扫描 DSH 进程监听的 loopback 端口并探测 `/api/llm-queue/state`。也可以看启动日志里的这行：

```
llm-queue: 面板已挂载 http://127.0.0.1:<port>/llm-queue
```

两个入口读写同一份配置，保存在 `$DSH_HOME/llm-queue/config.json`，**该文件优先于 bundle 里的默认值**。

## 参数

| 字段 | 含义 |
|---|---|
| `providers` | 命中哪些 provider（必填，逗号分隔） |
| `models` | 模型白名单；留空 = 该 provider 下所有模型 |
| `rate.mode` | `spaced` 严格均匀间隔（3 RPM = 每 20 秒一个）；`burst` 令牌桶（先放 `burst` 个，再按 RPM 补） |
| `rate.rpm` | 每分钟放行数，`0` = 不限速（但仍受并发约束） |
| `rate.burst` | 仅 `burst` 模式：初始可突发数 |
| `rate.max_concurrent` | 同时在飞的请求上限 |
| `rate.max_wait_seconds` | 排队上限，`0` = 一直等（默认，保证不丢请求） |

同一车道的所有模型共享一个预算；要区别对待就建两条车道、各自填模型白名单。

## 验证

```bash
node --test test/queue.test.mjs test/plugin.test.mjs test/http.test.mjs test/client.test.mjs
```

24 个用例：间隔放行、并发上限、取消、排队超时、provider/模型匹配、总开关、配置热更新、`llm/stream` 拦截（排队期间不调用上游、上游抛错后槽位归还）、面板 API（状态 / 保存落盘 / 非法输入拒绝 / 非本机请求 403），以及客户端页面（bundle 工厂可加载、`settings.section` 注册正确、**取不到 react 时退化为空模块不拖垮宿主**、假 React 下渲染出车道与状态、草稿→提交的数值夹取）。

只想看面板长什么样、不想动 DSH：

```bash
node dev/preview.mjs --port 8799   # 打开 http://127.0.0.1:8799/llm-queue
```

## 要清楚的边界

- **排队 ≠ 提速**。3 RPM 的多步 agent 任务，每一步都要等 20 秒；插件只是把「429 失败」换成「慢但成功」。真要顺畅，仍然应该换更高配额的 key / 分组。
- 只拦 `llm/stream`。图片、视频等非流式端点不走这里（当前 DSH 的模型调用都统一在 stream 上）。
- 设置页的注册和渲染都包在 try 里：取不到 `react` 种子、或 `slots` 服务缺失时，插件安静退化成空模块 —— 宿主不会因为本插件而「Failed to load plugins」。
- 面板只接受本机同源请求（`remoteAddress` 必须 loopback，`sec-fetch-site` 不能是 `cross-site`）。
- 插件不碰任何密钥：`Authorization` 仍在适配器里，插件只负责放行时机。

## 仓库结构

```
lib/queue.js     排队与限速核心，纯逻辑无 IO（FIFO 车道 / spaced 与 burst 两种放行 / 并发上限 / 排队超时）
lib/index.js     服务端插件：挂 llm/stream、面板路由、配置读写、loopback 校验
lib/client.js    桌面端设置页，注册 settings.section（id: llm-queue, order: 45）
lib/page.js      备用单页面板
install.mjs      装进 profile（junction + 依赖登记 + bundles）
uninstall.mjs    撤销安装，--purge-config 连配置一起删
open-panel.mjs   扫描 DSH 监听端口并打开备用面板
dev/preview.mjs  不碰 DSH 的离线预览
test/            queue / plugin / http / client 四组共 24 个用例
```

## License

MIT
