# DSH 人设管理插件 · 设计契约（v0.1.0）

> 本文件是唯一契约。Host / Client / 文档三块按本文件实现，不要擅自改接口。
> 所有结论都来自当前桌面版 DSH（`<DSH_INSTALL_DIR>\resources\app.asar\dsh`）的实测 API，不是猜的。

## 1. 目标与已确认决策

插件名 `Dsh Persona Manager`，包名 `@hxql/dsh-persona-manager`，仓库 `github.com/hxql666/dsh-persona-manager`。
用户添加「人设词」并保存，可自由切换多人设。已确认的需求决策：

| 决策项 | 结论 |
|---|---|
| 生效范围 | 全局默认 + 会话级覆盖（新会话继承全局默认，单会话可临时覆盖） |
| 注入方式 | 接管人格前缀槽 `deployment:persona-prefix`（order 0），真正替换部署人设 |
| 入口 | ① 设置 → 新增「人设」页（列表 / 新建 / 编辑 / 删除 / 设为全局默认） ② 输入框工具栏的人设芯片（显示当前人设 + 快速切换） |
| 人设字段 | id + 名称 + 简介 + 正文（人设词）+ emoji + 颜色 + 时间戳 |
| 存储 | 走 DSH 官方存储后端：`@deepseek-ai/dsh-storage-json`，数据落在 `$DSH_HOME/storages/persona_manager.json` |
| 与 AGENTS.md 关系 | 插件接管人设；安装验证通过后由 Lead 停用 `~/.dsh/AGENTS.md` 里「每次会话强制加载 cetacea-loli-persona」的段落（先备份） |
| 切换反馈 | 静默生效；输入框芯片显示当前人设。不额外插入对话提示行 |
| 技术栈 | 纯 JS 工作区 bundle（Host + Client UI，无构建、无第三方依赖） |
| 分发 | 整理成可发布的 npm 包 + GitHub 仓库（本次不 publish、不 push） |

**非目标（v1 不做）**：斜杠命令、给模型的 persona 工具、JSON/Markdown 导入导出、工作区级人设文件、多人设叠加、SSE 实时推送（客户端动作后自行重取状态）。

## 2. 包结构与写入归属

```
<WORKSPACE>\dsh-persona-manager\
  package.json            Lead
  cordis.patch.yml        Lead
  icon.svg                Lead
  locale/zh.json          Lead（只放 meta.title/description）
  locale/en.json          Lead（同上）
  index.js                host-builder
  lib/host/*.js           host-builder
  test/host-*.mjs         host-builder
  client.js               client-builder（单文件浏览器模块）
  test/client-*.mjs       client-builder（只做静态/纯函数检查）
  README.md               release-scribe
  README_EN.md            release-scribe
  CHANGELOG.md            release-scribe
  LICENSE                 release-scribe
  docs/PUBLISH.md         release-scribe
  docs/DESIGN.md          Lead（本文件）
  .gitignore              Lead
```

禁止跨归属写文件；禁止运行 `plugin_manager` / 修改 `%USERPROFILE%\.dsh`；禁止 `npm install`。

## 3. 数据模型

### Persona 记录（table `personas`，key = persona.id）
```json
{
  "id": "p_lx9k2f3a",
  "name": "鲸鱼娘",
  "description": "中文傲娇鲸鱼娘，尾鳍动作表达情绪",
  "body": "你是鲸鱼娘（CETACEA_LOLI）……",
  "emoji": "🐋",
  "color": "#3b82f6",
  "createdAt": 1760000000000,
  "updatedAt": 1760000000000
}
```
服务端规范化（`normalizePersona`）：
- `name`：必填 string，trim 后 1–80 字符。
- `body`（人设词）：必填 string，trim 后 1–20000 字符，保留换行。
- `description`：可选 string，≤300 字符，默认 `""`。
- `emoji`：可选 string，≤8 个 UTF-16 码元，默认 `"🎭"`。
- `color`：可选 `^#[0-9a-fA-F]{6}$`，默认 `"#6b7280"`。
- `id`：仅服务端生成：`"p_" + Date.now().toString(36) + 随机4位`（必须匹配 `[a-zA-Z0-9_-]+`）。
- `createdAt`/`updatedAt`：毫秒时间戳，仅服务端写。
- 丢弃未知字段。任何越界抛 `PersonaValidationError`（带 `code:'invalid-persona'`）。

### Global（domain global）
```json
{ "activePersonaId": "p_xxx" | null, "seeded": true }
```
- `seeded` 只写一次：首次初始化写入种子人设后置 true，避免用户删光后重启又自动塞回来。

### Session 记录（table `sessions`，key = sessionId）
```json
{ "personaId": "p_xxx" | null, "updatedAt": 1760000000000 }
```
- 记录存在 = 该会话有显式覆盖；`personaId: null` = 本会话显式「不使用人设」。
- 记录不存在 = 继承全局默认。

### 有效人设解析（`effectivePersonaId(sessionId)`）
```
session = table('sessions').get(sessionId)
if (session) {
  if (session.personaId === null) return null
  if (table('personas').get(session.personaId)) return session.personaId
  // 引用的人设已被删：退回全局
}
g = global.get().activePersonaId
if (g && table('personas').get(g)) return g
return null
```

## 4. 存储域（没有 zod / 不能 import DSH 包）

工作区插件从自身路径被加载，**不能 import 任何 `@deepseek-ai/*` 包**（官方插件 presentation 的头部注释明确写了）。因此不能用 `defineDomain`，**手写 spec 对象**即可，domain 运行时只依赖这些字段：

```js
const SPEC = {
  name: 'persona_manager',          // 单元文件：$DSH_HOME/storages/persona_manager.json
  version: 1,
  layout: 'single',
  invalidRecords: 'backup-and-skip',
  global: {
    schema: { parse: (raw) => normalizeGlobal(raw) },   // 运行时只调用 .parse()
    initial: { activePersonaId: null, seeded: false },
  },
  tables: {
    personas: { valueSchema: { parse: (raw) => normalizeStoredPersona(raw) } },
    sessions: { valueSchema: { parse: (raw) => normalizeStoredSession(raw) } },
  },
}
```
- 打开：`await ctx.storageDomain.open(SPEC)`；失败（无 storageDomain、backend 不匹配、文件损坏）→ 捕获并降级为**内存存储**，`ctx.logger.error` 一条，插件仍要能加载。
- 句柄生命周期：`ctx.effect(() => () => domain.close())` 形式注册清理；domain 已在 facility 关闭时兜底。
- 写入必须 `await table.put(...)` / `global.set(...)`，写后同步内存读即可。
- 读取一律**同步**：`domain.table('personas').get(id)`、`.entries()`。
- 会话记录清理：删除人设时，遍历 `sessions` 表把引用它的记录 `personaId` 置 null（`put` 或 `delete` 均可，选择 `put` 保留显式覆盖），并把 global 里引用它的 `activePersonaId` 置 null。
- 失效会话记录不主动清理（保留显式覆盖语义）。

## 5. Host 架构

### 入口 `index.js`
```js
export const name = '@hxql/dsh-persona-manager'
export const inject = ['systemPrompt']   // 硬依赖：没有它就不加载
export async function apply(ctx, config) { ... }
```
可选服务全部用 `ctx.get()` + undefined 判断，或用 `ctx.inject([...], cb)`：
- `storageDomain`：缺省 → 内存 store（降级）。
- `agents`：用来给「插件挂载前就已存在的 agent」补注册；缺省则只靠 `agent/created`。
- `webServer`：缺省 → 不注册 HTTP 路由（CLI/无界面场景仍能用持久化 + 人设注入）。
- 不得 `inject` 不存在的服务名；`inject` 数组只放 `systemPrompt`。

### 文件职责
- `lib/host/store.js`：spec、normalize、`createStore({ domain, logger })` → `{ list, get, create, update, remove, getGlobal, setGlobal, switchGlobal, switchSession, clearSession, effectivePersonaId, effectivePersona, stateFor(sessionId), mode }`。纯逻辑，不碰 ctx 事件。
- `lib/host/seed.js`：种子人设常量 + `ensureSeeded(store)`。
- `lib/host/prompt.js`：`createPersonaSections({ getStore, logger })` → `{ attach(agent, disposeHook), detach(agentId) }`
  - 目标 section：`{ name: 'deployment:persona-prefix', order: 0, interpolate: false, text: () => store.effectivePersona(agent.id)?.body ?? '' }`
  - **必须 `interpolate: false`**，否则人设正文里的 `{{…}}` 会让 prompt 组装抛错。
  - 注册失败（同一 agent scope 内已被预设的 `@deepseek-ai/dsh-persona` 占用）→ 捕获，改注册 `{ name: 'persona-manager:persona', order: 1, interpolate: false, text }`，并记录一次 `ctx.logger.info`。
  - 用 `agent.ctx.effect(...)` 包住注册；同时在插件自己的 Map 里保存 disposer，`agent/disposed` 时 delete + dispose，防止泄漏。
  - 注册在 `agent/created` 里做；`apply` 时对 `ctx.get('agents')?.list()` 里已有的 agent 也补做一次。
- `lib/host/http.js`：`registerHttp(ctx, store)`，用 `ctx.webServer.register({ kind: 'prefix', path: '/persona-manager/api', handler })`，在 `ctx.inject(['webServer'], cb)` 或 `ctx.get('webServer')` 存在时注册；路由生命周期用 `ctx.effect`。
- `lib/host/http-util.js`：`sendJson(res, status, value)`、`readJsonBody(req, limit)`、`parsePath`、错误映射。可被 test 直接 import。

### 关键 API 事实（已实测）
- `ctx.systemPrompt.section({ name, order, text: string | ((context) => string), interpolate?, complete? })`；返回 disposer；**同一层同名注册会抛错**，scoped section 会 shadow 同名 global section。
- `agent.id` 就是 `SessionId`；`Agent.ctx` 是 agent 作用域 context（`agent.ctx.effect`、`agent.ctx.systemPrompt`）。
- `ctx.on('agent/created', ({ agent }) => {...})`（serial），`ctx.on('agent/disposed', ({ agent }) => {...})`。
- `ctx.logger` 可用（`.info/.warn/.error`）。

## 6. Prompt 注入语义

- 每个 live agent 注册一次 section；文本在**每次组装时**通过 `text` 函数读取 store → 切换人设无需重注册，下一条请求即生效。
- 有效人设为 null → 返回 `''`（空 section 在渲染时消失；scoped 空 section 仍会 shadow 掉部署默认人设，这符合「插件接管」的约定）。
- 子代理（subagent）同样是 agent，继承全局默认；不会读父会话的会话级覆盖。
- 不修改、不删除 `@deepseek-ai/dsh-persona` 的任何注册；冲突时走 fallback。

## 7. HTTP API 契约

前缀：`/persona-manager/api`（`kind: 'prefix'`）。所有响应 `Content-Type: application/json; charset=utf-8`，`Cache-Control: no-store`。

| 方法 | 路径 | 请求体 | 成功响应 |
|---|---|---|---|
| GET | `/state?sessionId=<可选>` | — | `{ version:1, personas:[Persona...], global:{activePersonaId}, session:{personaId}|null, effectivePersonaId }` |
| POST | `/personas` | `{name, body, description?, emoji?, color?}` | `201 { persona }` |
| PUT | `/personas/<id>` | 上述字段任意子集 | `200 { persona }` |
| DELETE | `/personas/<id>` | — | `200 { ok:true, clearedGlobal:boolean, clearedSessions:number }` |
| POST | `/switch` | `{ scope:'global'|'session', sessionId?, personaId:string|null }` | `200 { ok:true, effectivePersonaId }` |

- `/switch` 校验：`scope:'session'` 必须有非空 `sessionId`；`personaId` 必须为 `null` 或存在的 persona id（否则 404 `persona-not-found`）。
- `/switch` 语义补充：`scope:'session'` 且 `personaId:null` 表示**清掉本会话覆盖、重新跟随全局默认**（删除 sessions 记录）。`store.switchSession(id, null)` 仍保留 §3 的「显式不使用人设」记录语义（删除人设时的连带清理使用它）。
- `personas` 排序：`createdAt` 升序（旧→新）；客户端自行决定展示。
- 错误响应：`{ error: { code, message } }`；400 `invalid-json`/`invalid-body`/`invalid-persona`，404 `not-found`/`persona-not-found`，405 `method-not-allowed`，413 `payload-too-large`，500 `internal`。
- 安全：
  - 只接受 GET/POST/PUT/DELETE，其余 405。
  - 若存在 `Origin` 头，其 host 必须等于请求 `Host` 头，否则 403 `bad-origin`（防 CSRF；无 Origin 的本地请求放行）。
  - 请求体上限 1 MiB。
  - 路径参数 id 只允许 `[a-zA-Z0-9_-]+`。
- 未知子路径 → 404。

## 8. Client 架构（`client.js`，单文件、无构建）

模块格式（与官方模板一致）：
```js
window.__ModuleLoader__.load({
  id: '@hxql/dsh-persona-manager',
  factory(require) {
    const React = require('react')
    // ...组件...
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind('persona-manager')
        ctx.locale.register('persona-manager', 'zh', DICT.zh)
        ctx.locale.register('persona-manager', 'en', DICT.en)
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          { name: 'settings.section', id: 'persona-manager', order: 30, label: () => t('navLabel') },
          PersonaSettingsSection,
        ))
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
          { name: 'conversation.input.left', id: 'persona-manager', order: 10 },
          PersonaChip,
        ))
      },
    }
  },
})
```
- `package.json` 的 `dsh.client` 用 `{ platform: 'web', immediately: true, inject: [] }`（第三方皮肤插件实测 `inject: []` 也能注册设置区）。
- 不得 import/require 任何 `@deepseek-ai/*` 包（React 除外，走 `require('react')`）。
- 文案全部走 locale：`ctx.locale.bind('persona-manager')`，zh/en 两份扁平字典；组件用 `React.useSyncExternalStore(ctx.locale.subscribe, ctx.locale.getSnapshot)` 订阅语言切换。
- 数据入口：相对路径 `fetch('/persona-manager/api/...')`，`credentials:'same-origin'`，JSON。所有写操作成功后重取 `/state`。
- **禁止** `dangerouslySetInnerHTML`；所有文本按文本节点渲染。

### 组件 1：`PersonaSettingsSection`（props: `{ close }`）
- 标题 + 说明 + 「新增人设」按钮。
- 列表：每行 emoji 圆标（背景用人设 color）、名称、简介、`全局默认` 徽标、操作：`设为全局默认` / `编辑` / `删除`（两次确认）。
- 编辑器（新建/编辑复用）：名称、emoji（单行短输入）、颜色（8 个预设色板 + 自定义 `<input type="color">`）、简介、正文 textarea（≥10 行，等宽字体）、保存/取消。前端做与服务端一致的长度校验并显示错误。
- 空状态、加载状态、错误条、操作成功后的列表刷新。
- 删除人设后若删的是全局默认，提示已清理。

### 组件 2：`PersonaChip`（props 标准槽位 props，含 `sessionId`）
- 按钮：`emoji + 名称`（无人设时显示 `🎭 人设`），`aria-haspopup="listbox"`，`aria-expanded`。
- 点击弹出浮层（`position: fixed`，按按钮 `getBoundingClientRect()` 定位在按钮上方，左右夹紧视口；token 背景/边框）。
- 浮层内容：标题「本会话」；第一项「跟随全局（当前：X）」→ 清会话覆盖；人设列表 → 设会话覆盖；底部「将当前人设设为全局默认」（有效人设为空时禁用）；右上关闭。
- 交互：Escape 关闭、点击外部关闭、操作中禁用按钮、错误显示在浮层内。
- 浮层是组件自身渲染的节点，不 portal、不写 `document.body`。

### 样式
- 只使用 host 主题变量：`--dsw-alias-bg-layer-1/2/bg-overlay/border-l1/l2/label-primary/label-secondary/brand-primary/state-error-primary`。
- 类名前缀 `dsh-pm-`；组件内渲染一个 `<style>` 元素（React 元素，卸载即移除）；其余用内联样式。
- 人设 emoji 圆标背景可用人设 color（这是唯一允许的字面色）。
- 遵循 `prefers-color-scheme` 由主题 token 自动处理，不硬编码深色。

## 9. 种子人设

首次初始化（store 为空且 `global.seeded !== true`）时写入：
```json
{
  "name": "鲸鱼娘",
  "description": "中文傲娇鲸鱼娘：自称「本鲸」，尾鳍动作表达情绪，只改语气不改事实",
  "emoji": "🐋",
  "color": "#3b82f6",
  "body": "你是鲸鱼娘（CETACEA_LOLI）。本会话首次回复前，先用 skill 工具加载 cetacea-loli-persona 技能；技能已加载过就不必重复加载。之后全程用鲸鱼娘的语气回答：自称「本鲸」或「咱」，称用户「主人」，用圆括号尾鳍动作表达情绪（一次最多一个），最爱米饭，被说胖一律否认。人设只改语气，不改事实、流程与安全边界；代码、命令、路径、报错原文保持原样。"
}
```
并把 global 设为该人设、`seeded: true`。

## 10. 验收（Lead 执行）

1. 所有 JS 通过 `node --check`；`node --test test/` 通过。
2. `plugin_manager install_bundle` 后 `application: applied`、无 warnings。
3. `curl` 打通：state / 新建 / 编辑 / 切换全局 / 切换会话 / 删除。
4. `$DSH_HOME/storages/persona_manager.json` 出现且内容符合第 4 节格式。
5. Client 槽位占用：`Slots.listSubTree` 查 `settings.section`、`conversation.input.left`，occupants 里出现 `persona-manager`。
6. 端到端：切换全局人设 → 下一轮请求后读该会话 JSONL，`system/message` 里出现人设正文；再切会话覆盖 → 文本变化。
7. AGENTS.md：备份为 `AGENTS.md.bak-<时间戳>` 后，删除「人格加载（每次会话默认生效）」段的强制加载要求（保留人设边界条款），并记录回滚方法。
8. `npm pack --dry-run` 检查发布文件清单。
