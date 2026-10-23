# Changelog

本项目所有值得记录的变更都记录在此文件。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

> **状态（2026-10-23）**：`0.1.0` 已完成并验证，已开源到 GitHub（v0.1.0）并发布到 npm（`@hxql/dsh-persona-manager@0.1.0`）；
> `0.1.1` 修正文档与发布状态；`0.1.2` 为安全修复版（API 请求信任围栏），均已推送 GitHub 并发布 npm。

## [Unreleased]

## [0.1.2] - 2026-10-23

### Security

- 修复 DNS rebinding 暴露：`/persona-manager/api` 处理前应用 DSH Connection 信任围栏（`ctx.connection.requestRejection({ headers })`）——伪造 Host/Origin 返回 403 `untrusted`，未认证请求返回 401 `unauthenticated`；Connection 不可用时退回 Host fence（仅 Web origin host / loopback host）并拒绝 `sec-fetch-site: cross-site`。
- 新增 9 个自动化测试（围栏单元测试 + 真实 `apply()` 集成：403 / 401 / 放行三条路径）。

### Changed

- 文档：API 章节注明只服务浏览器页面（命令行无 Cookie 会得到 401）；本机路径改为占位符；测试计数更新为 92。
- 仓库卫生：`.gitignore` 增加 `.npmrc`、`.env*`、`*.pem`、`*.key`、`*.crt`、`npm-debug.log*`。

## [0.1.1] - 2026-10-23

### Changed

- 文档与发布状态：README / README_EN 增加 npm 徽章与 npm 安装方式，状态更新为「已开源 + 已发布」；CHANGELOG、docs/PUBLISH.md、docs/VERIFY.md 同步发布记录。无代码行为变化。

## [0.1.0] - 2026-10-23

### Added

- **多人设管理**：新增设置区页面「人设管理」（`settings.section`，order 30），支持人设列表、新建、编辑、删除、设为全局默认；删除需两次确认，列表显示「全局默认」徽标。
- **人设编辑器**：名称、emoji、颜色（8 个预设色板 + 自定义取色器）、简介、正文 textarea；前端做与服务端一致的长度校验并显示错误。
- **全局默认 + 会话级覆盖**：全局默认对所有无覆盖的会话生效；单会话可临时覆盖、可「跟随全局」清除覆盖，也可显式「不使用人设」（`personaId: null`）。
- **输入框人设芯片**（`conversation.input.left`，order 10）：显示当前人设（emoji + 名称，无人设时显示 `🎭 人设`）；浮层支持「跟随全局（当前：X）」、会话切换、将当前人设设为全局默认；支持 Escape / 点击外部关闭。
- **接管人设前缀槽**：为每个 live agent 在 `deployment:persona-prefix`（order 0，`interpolate: false`）注册系统提示词 section，正文取有效人设的 `body`；每次组装 prompt 时重新读取，切换人设下一条请求生效。
- **有效人设解析**：会话无记录 → 全局默认；会话覆盖 → 指定人设；`personaId: null` → 显式无人设；引用的人设已删除 → 退回全局；全局默认已删除 → 无人设。
- **空人设语义**：有效人设为空时 section 文本为空串，渲染时消失，但 scoped 空 section 仍 shadow 部署默认人设（符合「插件接管」约定）。
- **冲突 fallback**：若同一 agent 作用域内 `deployment:persona-prefix` 已被 `@deepseek-ai/dsh-persona` 占用，改注册 `persona-manager:persona`（order 1）并记录一次 `logger.info`；不修改、不删除对方注册。
- **官方 JSON 存储**：通过 `@deepseek-ai/dsh-storage-json` 持久化，存储域 `persona_manager`（`version: 1`、`layout: 'single'`、`invalidRecords: 'backup-and-skip'`），数据落在 `$DSH_HOME/storages/persona_manager.json`；`storageDomain` 缺失或打开失败时降级为内存存储并记录 `logger.error`。
- **删除人设的连带清理**：清除引用该人设的会话覆盖（`personaId` 置 `null`，保留显式覆盖）与全局默认引用，接口返回 `clearedGlobal` / `clearedSessions`。
- **种子人设**：首次初始化（人设表为空且未 seeded）写入示例人设「鲸鱼娘 🐋」并设为全局默认；`global.seeded` 只写一次，删光后不会自动回灌。
- **本地 HTTP API**：`/persona-manager/api` 提供 `GET /state`、`POST /personas`、`PUT /personas/<id>`、`DELETE /personas/<id>`、`POST /switch`；统一 JSON 错误结构，Origin/Host 同源校验（403 `bad-origin`），1 MiB 请求体上限，方法白名单与 id 字符集限制。
- **国际化与主题**：Client 文案走 zh / en 两份 locale 字典，跟随界面语言切换；样式只使用宿主主题变量，类名前缀 `dsh-pm-`，人设 emoji 圆标背景使用人设 `color`。
- **Workspace bundle 与包元数据**：`cordis.patch.yml` 只插入一行 Host 插件记录（id `persona-manager`）；`package.json` 提供 `dsh.bundle` / `dsh.client` 配置、`exports`、`icon`、`files` 清单（纯 JS，无构建、无第三方运行时依赖）。
- **文档**：`README.md`（简体中文）、`README_EN.md`（英文，章节结构对应）、`CHANGELOG.md`、`LICENSE`（MIT）、`docs/PUBLISH.md`（发布前检查与回滚）、`docs/DESIGN.md`（设计契约）。
- **测试脚本**：`npm test`（= `node --test`，自动发现 `test/*.test.mjs`）；Host 侧测试文件 `test/host-*.mjs`，Client 侧为静态 / 纯函数检查 `test/client-*.mjs`。

### Notes

- 发布状态：本版本是首个发布版本（GitHub `v0.1.0` Release + npm `0.1.0`）。
- v1 非目标：斜杠命令、给模型的 persona 工具、JSON/Markdown 导入导出、工作区级人设文件、多人设叠加、SSE 实时推送。
