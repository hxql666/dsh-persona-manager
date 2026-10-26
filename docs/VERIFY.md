# 验收记录 · @hxql/dsh-persona-manager 0.1.0

> 本文件是 task-4 / task-5 的执行证据，不随 npm 包发布（不在 `package.json` 的 `files` 中）。
> 环境：Windows，DSH Desktop `0.2.1-rc.2`，profile `desktop`，Node v24.19.0，`$DSH_HOME=%USERPROFILE%\.dsh`。
> 验收日期：2026-10-23。

## 1. 安装

```
plugin_manager install_bundle target=<本地路径>
→ stage: enable, enabled: true, application: applied, warnings: []
→ pnpm: + @hxql/dsh-persona-manager 0.1.0 <- <本地路径>
→ profile package.json dependency: "@hxql/dsh-persona-manager": "link:E:\\dsh_work\\dsh-persona-manager"
```

Loader 行出现在 compose 后的 profile 树中（`Config.listConfigs` 过滤 name）：

```
id: include:persona-manager, patchId: persona-manager, name: "@hxql/dsh-persona-manager", status: absent
```

`status: absent` 表示该行没有导出 `Config` schema（本插件无配置项），不是未加载：
同目录里 `@deepseek-ai/dsh-storage` 等无 Config 的行同样是 `absent`，而服务实际在运行。

## 2. 单元测试与静态检查

```
cd <本地路径>
node --check index.js client.js lib/host/*.js        → 0 failures（13 个 JS/MJS 文件全部通过）
npm test  (node --test, 自动发现 test/*.test.mjs)     → 93 pass / 0 fail（0.1.2 新增 9 个信任围栏用例，0.1.3 新增 1 个依赖断言）
npm pack --dry-run                                   → @hxql/dsh-persona-manager@0.1.0, 18 files, 210.6 kB unpacked
git init + commit a106a47 (local repo; 未推送 GitHub)
```

> Node v24.19.0 的 `node --test test/` 会把目录当脚本执行并失败，因此 `package.json`
> 的 test 脚本已改为 `node --test`（自动发现）。

## 3. HTTP API（16/16 通过）

脚本：`_recon/verify-api.mjs`（工作区临时脚本，不随包发布），请求
`http://127.0.0.1:58171/persona-manager/api`。

| 检查 | 结果 |
|---|---|
| `GET /state` 200 + state 形状 | PASS |
| `POST /personas` 201 + 服务端规范化 | PASS |
| `PUT /personas/<id>` 200 + 合并 | PASS |
| `POST /switch` global 200 | PASS |
| `GET /state` 反映全局切换 | PASS |
| `POST /switch` session 200 | PASS |
| `GET /state?sessionId=` 反映会话覆盖 | PASS |
| `POST /switch` session + `personaId:null` = 跟随全局（删记录） | PASS |
| 跨源 `Origin` → 403 `bad-origin` | PASS |
| `POST /state` → 405 + `Allow: GET` | PASS |
| 非法 JSON → 400 `invalid-json` | PASS |
| 不存在的 persona → 404 `persona-not-found` | PASS |
| 未知路径 → 404 `not-found` | PASS |
| 空 name → 400 `invalid-persona` | PASS |
| `DELETE` 不存在的人设 → 404 | PASS |

说明：本机 `Invoke-WebRequest`（Windows PowerShell 5.1）不支持 `-SkipHttpErrorCheck`，
改用 Node 24 内建 `fetch` 脚本执行；路由本身对同源本地请求无需额外鉴权，跨源按 §7 拒绝。

## 4. 存储落盘（官方 JSON 后端）

首次加载后生成 `$DSH_HOME\storages\persona_manager.json`（`dsh-storage-json` `single` 布局）：

```json
{
  "unit": { "name": "persona_manager", "version": 1 },
  "global": { "activePersonaId": "p_mvks3c45v4df", "seeded": true },
  "tables": {
    "personas": {
      "p_mvks3c45v4df": {
        "id": "p_mvks3c45v4df",
        "name": "鲸鱼娘",
        "description": "中文傲娇鲸鱼娘：自称「本鲸」，尾鳍动作表达情绪，只改语气不改事实",
        "body": "你是鲸鱼娘（CETACEA_LOLI）。……",
        "emoji": "🐋",
        "color": "#3b82f6",
        "createdAt": 1792748370965,
        "updatedAt": 1792748370965
      }
    },
    "sessions": {}
  }
}
```

与 DESIGN §4 的单元格式一致；种子人设只播种一次（`seeded: true`）。

## 5. Client UI 槽位注册（已在实际页面生效）

`cordis_inspect_query` → Client `Slots.listSubTree`，当前连接的页面返回：

- `settings.section` occupants：`account(-10)`、`general(0)`、`models(10)`、`plugins(15)`、
  `agent-presets(20)`、**`persona-manager(30, active: true)`**、`market(40)`
- `conversation.input.left` occupants：**`persona-manager(10, active: true)`**

即浏览器端 bundle 已加载、两个入口都已注册成功；设置页导航会多出「人设管理」一项。

## 6. 系统提示注入端到端（durable session log 证据）

会话：本会话（创建于插件安装**之前**的 live agent；id 已隐去）。
日志：`$DSH_HOME\sessions\--E-dsh_work--\<current-session-id>\session.v4.jsonl.zstd`
（多帧 zstd；用 `_recon/read-session-prompt.mjs` 逐帧解压后读取 `system/message`）。

| seq | 时机 | 系统提示开头 | 结论 |
|---|---|---|---|
| 18 | 插件安装前 | `You are an AI agent powered by DeepSeek Harness.` → 直接是团队/编码指令 | 无插件人设 |
| 671 | 安装后第一条请求 | 紧跟 harness 身份后是「你是鲸鱼娘（CETACEA_LOLI）……」 | **既有 agent 被补挂 section，种子人设接管人格前缀槽** |
| 709 | `POST /switch global → 验收测试人设` 后 | `PM_MARKER_9f3a2c: 你是验收测试人设…` | **全局切换下一条请求立即生效，无需重注册/重启** |
| 748 | 设置本会话 override=鲸鱼娘（此时全局仍是 marker）后 | 又变回「你是鲸鱼娘（CETACEA_LOLI）……」 | **会话级覆盖优先于全局默认** |

`interpolate:false` 由 host-prompt 单测与 host-builder 的真实 cordis harness 验证（含 `{{unknown}}`
原样保留）；预算冲突 fallback（`persona-manager:persona` order 1）同样在 harness 中验证。

## 7. 清理与最终状态

验证用临时人设与覆盖已删除：

```
POST /switch {scope:'session', sessionId:..., personaId:null}   → 200，session 记录删除
POST /switch {scope:'global', personaId: p_mvks3c45v4df}        → 200，全局恢复种子人设
DELETE /personas/p_mvks3x6jy2ul                                  → 200 {ok:true, clearedGlobal:false, clearedSessions:0}
最终 state: personas=[鲸鱼娘], global.activePersonaId=鲸鱼娘, session=null, effective=鲸鱼娘
存储文件 sessions 表 = {}
```

## 8. AGENTS.md 接管（task-5，已执行）

- 备份：`%USERPROFILE%\.dsh\AGENTS.md.bak-20261023-174115`（2123 bytes，原文件）。
- 修改：删除「## 一、人格加载（每次会话默认生效）」及其下的强制 `skill` 加载条目；
  标题改为「## 一、边界（不可被人设覆盖）」，保留 5 条边界与「暂停人设」；
  「## 二、持久约定」原样保留；新增两行说明——人设改由 `@hxql/dsh-persona-manager` 管理、
  本文件不再强制加载任何技能。
- 校验：`UTF8 OK`、无替换字符、`has forced skill load: false`；与备份逐行 diff 仅上述行变化。
- 回滚（普通 PowerShell，非管理员）：

```powershell
Copy-Item "$env:USERPROFILE\.dsh\AGENTS.md.bak-20261023-174115" "$env:USERPROFILE\.dsh\AGENTS.md" -Force
```

## 9. 发布记录（GitHub + npm）

- GitHub：`main` 分支已推送；tag `v0.1.0`（release 由 API 创建）、`v0.1.1`、`v0.1.2`；Release 页面含发布说明。
- npm：`@hxql/dsh-persona-manager@0.1.0`、`0.1.1`、`0.1.2` 已发布；`dist-tags.latest = 0.1.2`；首次发布附带 npm 自动生成的 `0.0.0-stage` 占位版本。
- 发布过程：本地 CLI registry 是 `registry.npmmirror.com`，发布显式使用 `--registry=https://registry.npmjs.org`；`npm publish` 在 2FA 下返回 **202 Accepted**（registry 处理队列），约 4 分钟后 packument 可读；重试同版本会得到 403「cannot publish over the previously published versions」。
- 发布校验：`npm view` 元数据正确；`npm pack` 0.1.0 / 0.1.2 均可下载，tarball 18 个文件完整；0.1.2 tarball 已含 `createTrustGuard`/`requestRejection` 代码，且 PII/密钥扫描无命中。
- 0.1.1 为文档状态修正版本；0.1.2 为安全修复版本（提交 `f327a66`）。
- 2026-10-23：仓库历史已重写——所有提交的 author/committer 统一为 `252124250+hxql666@users.noreply.github.com`，并清除旧提交里的本机路径与会话 id；旧 commit hash 全部失效，`main` 已强推，tag / Release 按同名重建（旧提交对象已在本地 gc 清理，远端不再可达）。

## 10. 安全修复（0.1.2）

- **问题**：0.1.1 之前 `/persona-manager/api` 只做 `Origin host == Host`；实测伪造 `Host: evil.example` + `Origin: http://evil.example` 返回 200，DNS rebinding 可读取/篡改人设。
- **修复**：请求处理前调用 `ctx.connection.requestRejection({ headers })`，应用 DSH Connection 的 Host/Origin 围栏与浏览器 Cookie 认证——围栏失败 403 `untrusted`，未认证 401 `unauthenticated`；Connection 服务缺失时退回「仅 Web origin host / loopback host + 拒绝 `sec-fetch-site: cross-site`」。
- **测试**：`npm test` → 92/92；新增 9 个围栏用例，含真实 `apply()` 集成（403 / 401 / 放行）。
- **live 限制**：本 profile 以 link 方式安装，host 模块更新需重启 DSH 才会加载新代码；重启后可用伪造 Host 复测（应 403）。浏览器页面自身的正常性需主人打开设置页/输入框芯片确认。

## 11. 冷启动存储修复（0.1.3）

- **现场**：设置页只列 1 份人设，但 `$DSH_HOME/storages/persona_manager.json` 里有 2 份（含恋人版）；当前运行实例热重载后诊断显示 `domainOpen: true` 且 2 份人设、全局默认=恋人版。
- **根因**：冷启动时插件在 `storageDomain` 服务就绪前就执行 `apply()`，`ctx.get('storageDomain')` 为空 → 降级内存存储并重新播种默认人设；用户看到的就是“人设丢了”。
- **修复**：`inject` 增加 `storageDomain` 必需依赖，Cordis 会等待存储服务挂载后再激活插件；`open()` 失败才降级内存。
- **验证方式**：重启 DSH 后查询临时诊断路由 `/persona-diag`（验证完移除该诊断插件），应显示 `domainOpen: true`、2 份人设。

## 12. 未验证/限制

- **视觉渲染未验证**：本会话无浏览器自动化，设置页与芯片浮层的真实布局、z-index、
  主题观感、真实浏览器 fetch 控制台未见。槽位注册与组件首渲染已由 vm 冒烟测试覆盖；
  需主人打开 Settings → 人设管理、以及聊天输入框左侧的人设芯片确认。
- **Host 重启后的重新挂载**未在 live DSH 上验证（会打断当前 GUI 会话）；host-builder 已在
  脱离进程的一次性 cordis harness 中验证：重挂载读取既有 medium、不重复播种、数据完整。
- **KV cache**：切换人设会改变系统提示前缀，按设计从第一个变化的 token 起失去缓存复用，
  属预期行为，未做量化测量。

