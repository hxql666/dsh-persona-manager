# DSH 人设管理插件（Dsh Persona Manager）

> 在 DeepSeek Harness 里创建、保存并自由切换多份「人设词」：一份全局默认，外加每个会话可随时覆盖的临时人设。
> 插件接管系统提示词的人设前缀槽 `deployment:persona-prefix`（order 0），真正替换部署人设。

**文档语言**：简体中文（主）· [English](README_EN.md)

| 项目 | 值 |
|---|---|
| npm 包名 | `@hxql/dsh-persona-manager` |
| 版本 | `0.1.0` |
| 许可证 | MIT，见 [LICENSE](LICENSE) |
| 仓库 | `https://github.com/hxql666/dsh-persona-manager`（**尚未 push**） |
| 设计契约 | [docs/DESIGN.md](docs/DESIGN.md)（行为描述的唯一依据） |
| 变更记录 | [CHANGELOG.md](CHANGELOG.md) |
| 发布说明 | [docs/PUBLISH.md](docs/PUBLISH.md) |

> **当前状态**：0.1.0 已按 [docs/DESIGN.md](docs/DESIGN.md) 准备完毕，但**尚未发布到 npm，也尚未 push 到 GitHub**。
> 所以现在只能从本地路径安装（Plugin Manager 或命令行均可）；git URL / npm 安装方式要等发布后才可用。发布前检查清单见 [docs/PUBLISH.md](docs/PUBLISH.md)。

## 目录

1. [能力摘要](#1-能力摘要)
2. [环境要求与 Host 服务依赖](#2-环境要求与-host-服务依赖)
3. [安装](#3-安装)
4. [界面入口](#4-界面入口)
5. [快速上手](#5-快速上手)
6. [使用与语义](#6-使用与语义)
7. [人设字段与校验](#7-人设字段与校验)
8. [数据存储](#8-数据存储)
9. [人设如何到达模型](#9-人设如何到达模型)
10. [安全边界](#10-安全边界)
11. [与 AGENTS.md 的关系（接管说明）](#11-与-agentsmd-的关系接管说明)
12. [HTTP API（进阶）](#12-http-api进阶)
13. [卸载与回滚](#13-卸载与回滚)
14. [故障排查](#14-故障排查)
15. [开发与测试](#15-开发与测试)
16. [版本与非目标](#16-版本与非目标)
17. [许可证与链接](#17-许可证与链接)

> 文中命令均在**普通 PowerShell（非管理员）**中执行。

## 1. 能力摘要

- **多人设 CRUD**：创建、编辑、删除人设；每个人设包含名称、简介、正文（人设词）、emoji、颜色。
- **自由切换**：全局默认（所有会话的默认人设）+ 会话级覆盖（单个会话临时改用人设，随时切回「跟随全局」）。
- **接管人设前缀槽**：在系统提示词的 `deployment:persona-prefix` 槽（order 0）注册人设正文，替换部署人设；未选人设时该槽为空，且仍然 shadow 掉部署默认人设（见第 9 节）。
- **两个入口**：设置里的「人设管理」页（列表 / 新建 / 编辑 / 删除 / 设为全局默认），以及输入框工具栏的人设芯片（显示当前人设 + 快速切换）。
- **静默生效**：切换人设不往对话里插入任何提示行；下一条模型请求即生效（见第 6、9 节）。
- **内置种子人设**：首次初始化自动写入一份示例人设（鲸鱼娘 🐋）并设为全局默认；用户删光后不会自动回灌。
- **官方存储**：数据走 DSH 官方 JSON 存储后端，落在 `$DSH_HOME/storages/persona_manager.json`；存储不可用时降级为内存存储，插件仍能加载。

**v1 非目标**：斜杠命令、给模型的 persona 工具、JSON/Markdown 导入导出、工作区级人设文件、多人设叠加、SSE 实时推送（客户端写操作后自行重取状态）。详见第 16 节。

## 2. 环境要求与 Host 服务依赖

- 运行在提供 **`systemPrompt`** 服务的 DeepSeek Harness（桌面版 / Web GUI 均可）。
- 纯 JS 工作区 bundle：Host 入口 `index.js`，浏览器端单文件 `client.js`，**无构建步骤、无第三方运行时依赖**（React 由宿主提供）。
- `package.json` 声明 `engines.node >= 18`；插件由 DSH 宿主运行时加载，不需要另外安装依赖。
- 客户端配置为 `dsh.client` 的 `platform: 'web'`，设置区与输入框工具栏需要 Web UI；无界面（CLI）场景仍可用持久化与人设注入。

插件对 Host 服务的依赖如下（`inject` 数组里只有 `systemPrompt`，其余全部可选并做缺失降级）：

| Host 服务 | 必需性 | 作用与缺失后果 |
|---|---|---|
| `systemPrompt` | **必需**（硬依赖） | 注册人设提示词 section；缺失时插件不会加载，设置页、芯片、HTTP API 全都不会出现 |
| `storageDomain` | 推荐（可选，缺省降级） | 经官方 `@deepseek-ai/dsh-storage-json` 后端持久化；缺失或打开失败时降级为**内存存储**，记录一条 `logger.error`，插件仍可加载，但重启后数据丢失 |
| `agents` | 可选 | 给「插件挂载前已经存在」的 agent 补注册人设 section；缺失时只处理挂载之后 `agent/created` 的 agent |
| `webServer` | 仅 UI 需要（插件本身可选） | 注册 `/persona-manager/api` HTTP 路由供 Client UI 调用；缺失时不注册路由，持久化与人设注入照常，但设置页与芯片拿不到数据 |

与 `@deepseek-ai/dsh-persona` 共存：插件**不修改、不删除**对方的任何注册；同一 agent 作用域内槽位被占用时走 fallback（见第 9 节）。

## 3. 安装

把本目录作为一个 **bundle** 装进目标 DSH profile，二选一。

### 方式一：Plugin Manager 安装 bundle

通过 DSH 的 Plugin Manager 安装本 bundle（对应契约验收中的 `plugin_manager install_bundle`）。包内 `cordis.patch.yml` 只做一件事：向 profile 的插件组合插入一行 Host 插件记录（id `persona-manager`，name `@hxql/dsh-persona-manager`）。

### 方式二：命令行安装

```powershell
# 普通 PowerShell（非管理员）
# 本地目录安装（当前 0.1.0 尚未 push，推荐这一种）
dsh plugin --profile <profile-name> add <WORKSPACE>\dsh-persona-manager

# Git URL 安装（要等仓库 push 之后才可用）
dsh plugin --profile <profile-name> add https://github.com/hxql666/dsh-persona-manager.git
```

说明：

- `<profile-name>` 换成目标 DSH profile 名；该命令会把插件注册进 profile 的插件组合（bundle 行），等价于 Plugin Manager 的 bundle 安装。
- 该命令会按预期修改该 profile 的插件配置，属正常安装行为。
- 装完**建议重启 DSH 应用**后再验证（确保新插件模块被加载）。

安装成功的判断：新会话的 Settings（设置）里出现「人设管理」，输入框工具栏出现人设芯片；首次初始化会自动写入种子人设。

> 本章的 `dsh plugin ... add` 命令来自本项目的发布约定；项目契约 [docs/DESIGN.md](docs/DESIGN.md) 只固定了 Plugin Manager 的 `install_bundle` 验收路径，两种方式安装的是同一个 bundle。

## 4. 界面入口

插件注册两个客户端槽位（`client.js`，单文件、无构建）：

| 槽位 | 组件 | 内容 |
|---|---|---|
| `settings.section` | 人设管理页（order 30） | 人设列表 / 新建 / 编辑 / 删除 / 设为全局默认 |
| `conversation.input.left` | 人设芯片（order 10） | 显示当前人设，点击弹出「本会话」切换浮层 |

- **设置页**：Settings（设置）→ **人设管理**（英文界面为 **Personas**；插件在 Plugin Manager 元数据里的标题是「人设管理 / Persona Manager」）。
- **人设芯片**：输入框工具栏左侧，显示「emoji + 名称」；当前无有效人设时显示 `🎭 人设`。
- 浮层内容：标题「本会话人设」→「跟随全局（当前：X）」→ 人设列表 → 底部「将当前人设设为全局默认」（无有效人设时禁用）；右上角关闭。支持 Escape 与点击外部关闭。
- 设置页列表每行：emoji 圆标（背景用人设颜色，即 `color` 字段）、名称、简介、「全局默认」徽标，以及 `设为全局默认` / `编辑` / `删除`（删除需两次确认）操作。
- 界面文案全部走 locale（中文 / English），跟随 DSH 界面语言。

## 5. 快速上手

1. 安装并启用 bundle，打开 DSH。首次初始化时人设列表为空且没有 seed 记录，插件会自动写入示例人设「鲸鱼娘 🐋」并设为全局默认。
2. 打开 Settings → 人设管理，点「新增人设」：填名称、emoji、颜色（8 个预设色板或自定义取色器）、简介、正文（人设词），保存。人设正文就是最终注入系统提示词的那段文本。
3. 在列表里对想要的人设点「设为全局默认」：之后所有没有会话级覆盖的会话都用它。
4. 想只改某一个会话：点输入框工具栏的人设芯片 → 选一个人设，本会话立即改用它；选「跟随全局（当前：X）」清除会话覆盖。
5. 切换是静默的，不会往对话里插入提示行；**下一条模型请求**就会带上新人设正文。

## 6. 使用与语义

### 6.1 全局默认 vs 会话级覆盖

| 状态 | 存储中的含义 | 生效范围 |
|---|---|---|
| 全局默认 | `global.activePersonaId` 指向某个人设 | 所有没有显式会话覆盖的会话 |
| 会话级覆盖 | `sessions` 表里该 `sessionId` 的一条记录 | 只作用于这个会话 |
| 跟随全局 | 该会话**没有** `sessions` 记录 | 继承全局默认 |
| 不使用人设 | 会话记录存在且 `personaId: null` | 该会话显式「无人设」，不会回退到全局 |

「跟随全局」和「不使用人设」是两件事：前者删掉覆盖、回到全局；后者保留一条显式覆盖，明确表示本会话不要人设。

### 6.2 有效人设如何解析

每个会话的最终人设按以下顺序解析（对应 `effectivePersonaId(sessionId)`）：

| 情形 | 有效人设 |
|---|---|
| 会话无记录 | 全局默认（存在且人设未被删）→ 否则无人设 |
| 会话记录指向仍存在的人设 | 该人设 |
| 会话记录 `personaId: null` | 无人设（显式不使用） |
| 会话记录指向已被删除的人设 | 退回全局默认 |
| 全局默认指向已被删除的人设 | 无人设 |

`sessionId` 就是 agent 的 `agent.id`（即 DSH 的 `SessionId`）。

### 6.3 生效时机

- 每个 live agent 只注册一次人设 section；section 的 `text` 是一个函数，**在每次组装 prompt 时**重新读取存储。因此切换人设不需要重新注册 section，也不需要重开会话，**下一条模型请求即生效**。
- 子代理（subagent）也是独立 agent，**只继承全局默认**，不继承父会话的会话级覆盖。
- 切换只写存储、不写对话：不会出现「已切换人设」之类的额外消息。

### 6.4 删除人设的连带处理

删除一个人设时，插件会同时清理引用它的地方：

- 所有把该人设作为会话覆盖的 `sessions` 记录：`personaId` 置为 `null`（保留显式覆盖，不回退全局）；
- 如果全局默认正指向它：`global.activePersonaId` 置为 `null`；
- 删除接口返回 `ok`、`clearedGlobal`、`clearedSessions`；若删除的是全局默认，设置页会提示已清理。

失效的会话记录不会被主动删除，而是保留显式覆盖语义（见 6.2 的解析规则）。

### 6.5 种子与「删光不回灌」

- 首次初始化（`personas` 为空且 `global.seeded !== true`）时写入一份种子人设「鲸鱼娘」，并设为全局默认，同时把 `global.seeded` 置为 `true`。
- `seeded` 只写一次：之后即使用户把人设全删了，重启也不会自动塞回种子人设。
- 想重新体验首次初始化：删除数据文件即可（见第 13 节）。

## 7. 人设字段与校验

人设记录（`personas` 表，key = `persona.id`）：

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

| 字段 | 必填 | 规则 | 默认值 |
|---|---|---|---|
| `name` | 是 | trim 后 1–80 字符 | — |
| `body` | 是 | trim 后 1–20000 字符，保留换行 | — |
| `description` | 否 | ≤300 字符 | `""` |
| `emoji` | 否 | ≤8 个 UTF-16 码元 | `"🎭"` |
| `color` | 否 | `^#[0-9a-fA-F]{6}$` 的 6 位十六进制颜色 | `"#6b7280"` |
| `id` | 只读 | 仅服务端生成：`p_` + `Date.now().toString(36)` + 随机 4 位，须匹配 `[a-zA-Z0-9_-]+` | 自动 |
| `createdAt` / `updatedAt` | 只读 | 毫秒时间戳，仅服务端写 | 自动 |

- 未知字段会被丢弃；任何越界会抛 `PersonaValidationError`（`code: 'invalid-persona'`），HTTP 层映射为 `400 invalid-persona`。
- 前端做与服务端一致的长度校验并显示错误；emoji 输入框是单行短输入，颜色可选 8 个预设色板或自定义 `<input type="color">`。

## 8. 数据存储

人设数据走 DSH 官方 JSON 存储后端 `@deepseek-ai/dsh-storage-json`，存储域名为 `persona_manager`，单文件单元（`layout: 'single'`），文件位置：

```
$DSH_HOME/storages/persona_manager.json
```

`$DSH_HOME` 是 DSH 的数据目录，Windows 下默认为 `%USERPROFILE%\.dsh`，即：

```text
C:\Users\<用户名>\.dsh\storages\persona_manager.json
```

单元文件由存储后端维护，结构示意如下（人设记录字段见第 7 节，会话记录字段见 6.1）：

```json
{
  "unit": { "name": "persona_manager", "version": 1 },
  "global": {
    "activePersonaId": "p_lx9k2f3a",
    "seeded": true
  },
  "tables": {
    "personas": {
      "p_lx9k2f3a": {
        "id": "p_lx9k2f3a",
        "name": "鲸鱼娘",
        "description": "中文傲娇鲸鱼娘，尾鳍动作表达情绪",
        "body": "你是鲸鱼娘（CETACEA_LOLI）……",
        "emoji": "🐋",
        "color": "#3b82f6",
        "createdAt": 1760000000000,
        "updatedAt": 1760000000000
      }
    },
    "sessions": {
      "<sessionId>": { "personaId": null, "updatedAt": 1760000000000 }
    }
  }
}
```

字段语义：

- `global.activePersonaId`：全局默认人设 id，或 `null`；`global.seeded`：是否已做过首次初始化（只写一次）。
- `sessions` 表的 key 是 `sessionId`；**记录不存在 = 继承全局默认**，`personaId: null` = 本会话显式不使用人设。
- 存储域配置为 `invalidRecords: 'backup-and-skip'`：读取到非法记录时备份并跳过，而不是让整个存储域打不开。

降级与手工维护：

- 没有 `storageDomain`、后端不匹配或数据文件损坏导致 `open` 失败时，插件捕获异常并降级为**内存存储**，只记录一条 `logger.error`，插件仍可加载；此时重启 DSH 数据会丢。
- 若要手工编辑该文件：先禁用插件（避免写入竞争）并备份原文件，改完再启用。数据文件格式错误或版本不符可能触发降级 / 备份跳过。

## 9. 人设如何到达模型

- 每个 live agent 注册一个系统提示词 section：

  ```js
  {
    name: 'deployment:persona-prefix',
    order: 0,
    interpolate: false,
    text: () => store.effectivePersona(agent.id)?.body ?? ''
  }
  ```

  即：人设正文进入 system prompt 的**人设前缀槽（order 0，靠前）**，替换部署人设。`text` 在每次组装时求值，所以切换人设下一条请求即生效。
- **必须 `interpolate: false`**：人设正文按纯文本注入，不做 `{{…}}` 模板插值；否则正文里的花括号会让 prompt 组装抛错。
- **空人设的语义**：有效人设为 `null` 时 `text` 返回 `''`；空 section 在渲染时会消失，但 scoped 空 section **仍会 shadow 掉部署默认人设**——即「不使用人设」时部署默认人设也不会回来，这符合「插件接管」的约定。
- **与 `@deepseek-ai/dsh-persona` 冲突**：若同一 agent 作用域内 `deployment:persona-prefix` 已被该预设占用，注册会抛错；插件捕获后改注册 `persona-manager:persona`（order 1，同样 `interpolate: false`），并记录一次 `logger.info`。此时它不再替换部署人设槽，而是额外注入一段人设文本。插件不会修改或删除对方的注册。

**KV 缓存注意**：人设正文位于 system prompt 最前面的前缀槽。切换人设会改变 prompt 前缀，如果上游模型/网关启用了 prompt（KV）缓存，从改动位置起的缓存复用会失效——切换后的第一条请求可能更慢或更贵。这是 prompt 前缀缓存的固有性质，不是插件的额外行为；频繁切换人设会反复打断缓存命中。

## 10. 安全边界

- **人设只改语气**：不改事实、不改变执行流程，也不越过安全边界。代码、命令、路径、报错原文等专有内容保持原样。
- **危险操作照旧确认**：删除、覆盖、提权、注册表/权限修改、外发数据等动作，仍然需要先说明风险与回滚方案并等待确认，人设不会豁免这些步骤。
- **不越权写入**：插件不会修改 `AGENTS.md`，也不会修改或删除 `@deepseek-ai/dsh-persona` 的任何注册；它只写自己的存储域与提示词 section。
- **人设正文会进入系统提示词**：正文最终会随请求发送给模型服务，**不要**把人设正文当作密钥库——不要写令牌、密码或私密数据。
- **本地 HTTP API**：只有 Origin/Host 同源校验（存在 `Origin` 头时其 host 必须等于 `Host`，否则 403 `bad-origin`）、1 MiB 请求体上限、方法白名单、id 字符集限制，**没有登录类鉴权**。不要把 DSH 的 Web 服务暴露到不可信网络。

## 11. 与 AGENTS.md 的关系（接管说明）

本插件接管的是 DSH 的**人设前缀槽**，而不是用户级指令文件。如果 `~/.dsh/AGENTS.md` 里还写着「每次会话强制加载某个人设技能」，那就是**第二个独立的人设来源**，会和插件注入的人设叠加/冲突。

按契约的验收要求，安装并验证插件注入生效后，建议这样处理（**手动操作，插件不会自动改**）：

1. 备份 `AGENTS.md`：

   ```powershell
   # 普通 PowerShell（非管理员）
   Copy-Item "$env:USERPROFILE\.dsh\AGENTS.md" "$env:USERPROFILE\.dsh\AGENTS.md.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
   ```

2. 编辑 `~/.dsh/AGENTS.md`，删除「人格加载（每次会话默认生效）」段落里的**强制加载要求**，保留人设边界条款（不改事实/流程/安全边界等约束）。
3. 重开一个会话，确认语气来自插件选中的有效人设。

**回滚**：把备份文件复制回 `AGENTS.md` 即可恢复原来的强制加载行为：

```powershell
# 普通 PowerShell（非管理员）；把 <时间戳> 换成实际备份名
Copy-Item "$env:USERPROFILE\.dsh\AGENTS.md.bak-<时间戳>" "$env:USERPROFILE\.dsh\AGENTS.md" -Force
```

## 12. HTTP API（进阶）

Client UI 通过同源相对路径访问 Host 路由，前缀为 `/persona-manager/api`（`kind: 'prefix'`）。响应均为 `Content-Type: application/json; charset=utf-8`，并带 `Cache-Control: no-store`。

| 方法 | 路径 | 请求体 | 成功响应 |
|---|---|---|---|
| GET | `/state?sessionId=<可选>` | — | `{ version: 1, personas: [...], global: { activePersonaId }, session: { personaId } \| null, effectivePersonaId }` |
| POST | `/personas` | `{ name, body, description?, emoji?, color? }` | `201 { persona }` |
| PUT | `/personas/<id>` | 上述字段任意子集 | `200 { persona }` |
| DELETE | `/personas/<id>` | — | `200 { ok: true, clearedGlobal, clearedSessions }` |
| POST | `/switch` | `{ scope: 'global' \| 'session', sessionId?, personaId: string \| null }` | `200 { ok: true, effectivePersonaId }` |

约束与错误：

- `scope: 'session'` 必须带非空 `sessionId`；`personaId` 为已存在的 id 时写入会话覆盖；`personaId: null` 表示**清除会话覆盖、重新跟随全局默认**（删除记录）。存储层仍保留「显式不使用人设」的记录语义，它只会在删除人设的连带清理中出现。
- `scope: 'global'` 且 `personaId: null` 表示清除全局默认（所有没有会话覆盖的会话回到「无人设」）。
- `personas` 按 `createdAt` 升序（旧 → 新）返回；展示顺序由客户端决定。
- 错误统一为 `{ error: { code, message } }`：400 `invalid-json` / `invalid-body` / `invalid-persona`，404 `not-found` / `persona-not-found`，405 `method-not-allowed`，413 `payload-too-large`，500 `internal`。
- 安全：只接受 GET/POST/PUT/DELETE（其余 405）；`Origin` 的 host 必须等于 `Host`（否则 403 `bad-origin`，无 `Origin` 的本地请求放行）；请求体上限 1 MiB；路径参数 id 只允许 `[a-zA-Z0-9_-]+`；未知子路径 404。

示例（普通 PowerShell，非管理员）：

```powershell
Invoke-RestMethod http://127.0.0.1:<port>/persona-manager/api/state | ConvertTo-Json -Depth 6
```

> `<port>` 以当前 DSH Web 服务的实际端口为准。

## 13. 卸载与回滚

- **卸载 / 停用**：在 Plugin Manager（或 profile 的插件组合）里禁用或移除本 bundle 的插件行。之后人设不再注入、设置页与芯片消失，`/persona-manager/api` 路由不再注册；部署默认人设重新生效（插件从未修改它）。
- **数据保留**：数据文件 `$DSH_HOME/storages/persona_manager.json` 不会被自动删除；重新安装后可继续使用。
- **彻底重置**：先禁用插件（避免写入竞争）→ 备份或删除 `$DSH_HOME/storages/persona_manager.json` → 重新启用/重启。删除后首次初始化会重新写入种子人设。
- **回滚到旧版本**：用上一版本的本地路径 / git tag 重新安装同一 profile 的 bundle；数据文件保留即可继续使用。
- **恢复 AGENTS.md**：如果按第 11 节改过，用 `AGENTS.md.bak-<时间戳>` 复制回去。

## 14. 故障排查

| 现象 | 可能原因 | 处理 |
|---|---|---|
| Settings 里没有人设管理、输入框也没有人设芯片 | bundle 未启用；或 profile 没有 `webServer`（UI 与 API 都依赖它） | 确认 bundle 行已启用并重启 DSH；确认 Host 提供 `webServer` |
| 设置页出现但列表一直加载失败 / `/persona-manager/api/state` 404 | 插件 Host 侧未加载（如缺少 `systemPrompt` 硬依赖），或 HTTP 路由未注册 | 查 Host 日志；确认 `systemPrompt` 服务存在 |
| 数据在重启 DSH 后全部丢失 | `storageDomain` 缺失或打不开 → 降级为内存存储 | 确认官方 `@deepseek-ai/dsh-storage-json` 后端可用；修复后重新保存人设（日志里会有一条 `logger.error`） |
| 切换了人设但模型没变化 | 改的是存储，**下一条请求**才生效；或该会话被显式设为「不使用人设」 | 发下一条消息再看；检查芯片显示的人设与预期一致 |
| 人设正文没有出现在 system prompt / 语气没变化 | 同一作用域已有 `@deepseek-ai/dsh-persona` 占用 `deployment:persona-prefix`，插件走了 `persona-manager:persona` fallback（日志有 `logger.info`）；或 `AGENTS.md` 里还有强制人设，两个来源叠加 | 检查日志与其他注入人设的预设/插件；按第 11 节处理 `AGENTS.md` |
| 接口返回 403 `bad-origin` | 请求带了 `Origin` 头，但其 host 与 `Host` 不一致（常见于反向代理） | 本机直连 DSH Web 服务，或让代理保持 Host/Origin 一致 |
| 接口返回 413 `payload-too-large` | 请求体超过 1 MiB | 人设正文上限 20000 字符，正常操作不会触发；检查调用方 |
| 接口返回 400 `invalid-persona` | 名称/正文为空或超长、简介超 300 字符、emoji 超 8 个 UTF-16 码元、颜色不是 `#rrggbb` | 按第 7 节校验规则修正 |
| 想彻底重来 | 存储里有历史数据 | 按第 13 节删除数据文件后重新初始化 |

## 15. 开发与测试

- 结构（纯 JS，无构建、无依赖）：

  ```text
  index.js          Host 入口（export name / inject / apply）
  lib/host/*.js     Host 实现（store / seed / prompt / http / http-util）
  client.js         浏览器端单文件模块（设置页 + 人设芯片）
  test/*.mjs        Host 测试（node --test）；Client 侧只做静态/纯函数检查
  cordis.patch.yml  bundle patch（插入一行 Host 插件记录）
  locale/*.json     插件元数据文案（zh / en）
  docs/DESIGN.md    设计契约（唯一依据）
  ```

- 命令（普通 PowerShell，非管理员；Node ≥ 18）：

  ```powershell
  npm test                 # = node --test test/
  node --check index.js    # 语法检查；lib/、client.js 同理
  ```

- 本项目没有依赖，**不需要** `npm install`。所有 JS 应能通过 `node --check`，`npm test` 应全部通过。
- 改动行为前先读 [docs/DESIGN.md](docs/DESIGN.md)；发布流程见 [docs/PUBLISH.md](docs/PUBLISH.md)。

## 16. 版本与非目标

当前版本 **0.1.0**（见 [CHANGELOG.md](CHANGELOG.md)）；尚未发布到 npm、尚未 push GitHub。

v1 明确**不做**（详见契约第 1 节）：

- 斜杠命令；
- 给模型的 persona 工具；
- JSON / Markdown 导入导出；
- 工作区级人设文件；
- 多人设叠加；
- SSE 实时推送（客户端写操作后自行重取 `/state`）。

## 17. 许可证与链接

- 许可证：**MIT**，Copyright (c) 2026 hxql，全文见 [LICENSE](LICENSE)。
- 仓库：`https://github.com/hxql666/dsh-persona-manager`（尚未 push）。
- 包名：`@hxql/dsh-persona-manager`。
- 相关文档：[设计契约](docs/DESIGN.md) · [发布说明](docs/PUBLISH.md) · [变更记录](CHANGELOG.md) · [English README](README_EN.md)。

---

本 README 与 [README_EN.md](README_EN.md) 章节结构一一对应；所有技术事实以 [docs/DESIGN.md](docs/DESIGN.md) 为唯一契约，版本与包信息以 `package.json` 为准。
