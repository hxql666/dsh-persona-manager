# 发布指南（v0.1.0）

> **当前状态：已发布。** `0.1.0` 已 push 到 GitHub（`main` + tag `v0.1.0` + Release）并发布到 npm；`0.1.1` 为文档状态修正版，同样推送 GitHub 并发布 npm。
> `0.1.2` 为安全修复版（API 请求信任围栏），同一流程发布。
> 发布经验：当前 npm 对 `npm publish` 走「处理队列 / 阶段性发布」，PUT 返回 **202** 后需等待几分钟才在 registry 可见；
> 新包首次发布会附加一个 `0.0.0-stage` 占位版本；2FA 通过 npm 的 web-auth 流程完成（`npm publish` 会打印 `https://www.npmjs.com/auth/cli/<id>`）。

执行任何发布动作（`npm publish`、`git push`、创建 Release）前，请先确认你（维护者）确实要对外发布。本文所有命令都在**普通 PowerShell（非管理员）**中执行。

## 1. 发布身份

| 项 | 值 | 来源 |
|---|---|---|
| npm 包名 | `@hxql/dsh-persona-manager` | `package.json` → `name` |
| 版本 | `0.1.0` | `package.json` → `version` |
| 仓库 | `https://github.com/hxql666/dsh-persona-manager` | `package.json` → `repository` |
| 主页 / 问题反馈 | `https://github.com/hxql666/dsh-persona-manager#readme` / `.../issues` | `package.json` → `homepage` / `bugs` |
| 许可证 | MIT | `package.json` → `license`、`LICENSE` |
| Node 引擎 | `>=18` | `package.json` → `engines` |
| bundle patch | `cordis.patch.yml` | `package.json` → `dsh.bundle.patch` |
| 客户端 | `platform: 'web'`、`immediately: true`、`inject: []` | `package.json` → `dsh.client` |
| 打包文件 | 见 §2.5 | `package.json` → `files` |

注意：`@hxql/...` 是 **scoped 包**，发布时必须显式 `--access public`（未设置 `publishConfig` 时 npm 默认按私有包处理，未付费账号会发布失败）。

## 2. 发布前检查

前置：Node ≥ 18、npm、git；工作目录 `<本地路径>\dsh-persona-manager`。

### 2.1 文件齐全

包内应有的文件与职责（契约 [docs/DESIGN.md](DESIGN.md) 第 2 节）：

```text
package.json           包元数据 / dsh bundle & client 配置 / exports / files
cordis.patch.yml       bundle patch：插入一行 Host 插件记录（id persona-manager）
icon.svg               插件图标（package.json icon / exports "./icon"）
locale/zh.json         插件元数据文案（zh）
locale/en.json         插件元数据文案（en）
index.js               Host 入口（export name / inject / apply）
lib/host/*.js          Host 实现：store / seed / prompt / http / http-util
client.js              浏览器端单文件模块（设置页 + 人设芯片）
test/host-*.mjs        Host 测试
test/client-*.mjs      Client 静态 / 纯函数检查
README.md, README_EN.md, CHANGELOG.md, LICENSE, docs/DESIGN.md, docs/PUBLISH.md
.gitignore             开发忽略项（不会进 npm 包）
```

检查命令：

```powershell
Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch '\\node_modules\\|\\.git\\' } | ForEach-Object { $_.FullName.Substring((Get-Location).Path.Length + 1) }
```

若已初始化 git，另跑 `git status --short`，确认没有遗漏或误提交的敏感文件。**任一应有文件缺失就先补齐，不要发布。**

### 2.2 JSON 与元数据有效性

```powershell
# 三个 JSON 都必须能解析
node -e "for (const f of ['package.json','locale/zh.json','locale/en.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('JSON ok')"

# 关键元数据字段必须存在
node -e "const p=require('./package.json'); const req=['name','version','description','license','exports','files','dsh','engines','repository','homepage']; const miss=req.filter(k=>!(k in p)); console.log(miss.length ? 'missing: '+miss.join(', ') : 'metadata ok'); console.log(p.name, p.version, p.license)"
```

### 2.3 exports / icon / locale 可达

`package.json` 里的每个入口都要指向真实存在的文件：

```powershell
node -e "const fs=require('fs'); const p=require('./package.json'); if(!('./locale/*.json' in p.exports)){console.error('missing locale export pattern');process.exit(1)} const targets=new Set([p.exports['.'],p.exports['./client'],p.exports['./package.json'],p.exports['./icon'],p.icon,p.dsh.bundle.patch]); for (const f of fs.readdirSync('locale')) targets.add('locale/'+f); const missing=[...targets].filter(f=>!fs.existsSync(f)); if(missing.length){console.error('missing: '+missing.join(', '));process.exit(1)} console.log('exports/icon/locale ok: '+[...targets].join(', '))"
```

预期输出包含：`index.js`、`client.js`、`package.json`、`icon.svg`、`cordis.patch.yml`、`locale/en.json`、`locale/zh.json`。

### 2.4 语法与测试

```powershell
node --check index.js
node --check client.js
Get-ChildItem lib\host -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { throw "syntax error: $($_.Name)" } }
npm test        # = node --test test/
```

要求：所有 JS 通过语法检查，`npm test` 全部通过。本包**没有依赖**，不需要也不应该在发布前执行 `npm install`。

### 2.5 `npm pack --dry-run` 文件清单

```powershell
npm pack --dry-run
```

按 `package.json` 的 `files` 清单，预期 tarball 内容如下（全部为纯文本，无二进制）：

| 文件 | 说明 |
|---|---|
| `package.json` | npm 强制包含 |
| `index.js` | Host 入口（`exports["."]`） |
| `lib/**/*.js` | Host 实现（`files` 中的 `lib`） |
| `client.js` | 浏览器模块（`exports["./client"]`） |
| `cordis.patch.yml` | bundle patch（`dsh.bundle.patch`） |
| `locale/zh.json`、`locale/en.json` | 插件元数据（`exports["./locale/*.json"]`） |
| `icon.svg` | 图标（`icon`、`exports["./icon"]`） |
| `README.md` | npm 主 README |
| `README_EN.md` | 英文 README（`files` 显式列出） |
| `CHANGELOG.md` | 变更记录 |
| `LICENSE` | MIT 全文 |
| `docs/DESIGN.md` | 设计契约 |
| `docs/PUBLISH.md` | 本指南 |

**不应出现**：`test/`、`.gitignore`、`node_modules/`、`*.tgz`、`coverage/`、`test-output/`。

核对方法：

- 清单缺项 → 检查文件是否真的存在、`files` 路径是否写错；
- 出现多余项 → 检查 `files` 是否过宽（例如误写 `"docs"` 会把设计契约之外的草稿也打进去）；
- 顺带看一眼输出的 package size / unpacked size，异常大说明混入了不该发布的内容。

### 2.6 元数据缺口（发布前建议处理）

- `package.json` 目前**没有 `author` 字段**。npm 不强制，但建议发布前补 `"author": "hxql"`，包页与仓库页会展示。
- 没有 `publishConfig`，所以发布命令必须带 `--access public`（见 §4）。
- `private` 未设置（默认可发布），无需改动。
- 首版版本号 `0.1.0` 与 `CHANGELOG.md` 一致；已发布的版本号不能再复用。

## 3. 版本与变更记录

版本策略（语义化版本）：

- `0.1.x`：向后兼容的问题修复；
- `0.2.0`：新增功能；
- `1.0.0`：对外 API / 数据格式进入稳定承诺。
- 当前存储域版本固定为 `version: 1`（[docs/DESIGN.md](DESIGN.md) 第 4 节），**当前没有数据迁移逻辑**。未来若改动数据结构，应设计迁移并升 major，避免旧数据文件失配。

发布流程：

1. 修改 `package.json` 的 `version` 为 `X.Y.Z`；
2. 在 `CHANGELOG.md` 中把 `[Unreleased]` 的内容移到 `[X.Y.Z] - <发布日期>`；
3. 提交：`git commit -m "chore(release): vX.Y.Z"`；
4. 打 tag：`git tag -a vX.Y.Z -m "vX.Y.Z"`；
5. push commit 与 tag（见 §5）；
6. 发布 npm（见 §4）；
7. 创建 GitHub Release（见 §5）。

首次发布即 `0.1.0` / tag `v0.1.0`。

## 4. 发布到 npm

```powershell
# 普通 PowerShell（非管理员）
npm login
npm config get registry        # 确认是 https://registry.npmjs.org/ 或你打算发布的 registry
npm publish --access public
npm view @hxql/dsh-persona-manager version
```

- 启用 2FA 时，`npm publish` 会要求一次性验证码（也可用 `--otp=<code>`）。
- `npm view ... version` 应输出 `0.1.0`。
- 再取一次包内容核对：`npm pack @hxql/dsh-persona-manager@0.1.0`（在临时目录执行），清单应与 §2.5 一致。
- 发布失败（版本已存在 / 权限 / 网络）：**不要**用同一个版本号重复发布不同内容；修好后发下一个 patch。

## 5. GitHub 仓库与 Release

先在 GitHub 创建**空仓库** `hxql666/dsh-persona-manager`（public，不要勾选 README / .gitignore / LICENSE 初始化，否则 push 会冲突），然后：

```powershell
# 普通 PowerShell（非管理员）
cd <本地路径>\dsh-persona-manager
git init -b main                          # 若目录还不是 git 仓库
git add .
git commit -m "chore: initial import v0.1.0"
git remote add origin https://github.com/hxql666/dsh-persona-manager.git
git push -u origin main
git tag -a v0.1.0 -m "v0.1.0 - initial release"
git push origin v0.1.0
```

Release：

- 在 GitHub 网页基于 tag `v0.1.0` 创建 Release，标题 `v0.1.0`，正文粘贴 `CHANGELOG.md` 的 `[0.1.0]` 段落（Keep a Changelog 格式本来就是给 Release 用的）。
- 若本机装了 `gh` CLI，也可以 `gh release create v0.1.0 --title v0.1.0 --notes-file CHANGELOG.md`（这会把整个 CHANGELOG 当正文，通常还是网页里只粘 0.1.0 段落更合适）。
- 仓库 About 建议填包名与一句简介，topics 与 `package.json` 的 `keywords` 保持一致（`deepseek-harness`、`dsh-plugin`、`dsh`、`cordis`、`persona`、`system-prompt`）。

## 6. 安装路径验证

### 6.1 本地路径（当前唯一可用方式，发布前就应先做）

```powershell
# 普通 PowerShell（非管理员）；<profile-name> 换成目标 profile
dsh plugin --profile <profile-name> add <本地路径>\dsh-persona-manager
```

验证清单：

1. 重启 DSH 后，Settings → 人设管理 出现，输入框工具栏出现人设芯片；
2. 新建 / 编辑 / 删除人设、设为全局默认、会话覆盖 / 跟随全局都正常；
3. `$DSH_HOME/storages/persona_manager.json` 生成，结构符合 [../README.md](../README.md) 第 8 节；
4. 切换全局人设 → 下一条模型请求生效；新会话继承全局；子代理继承全局；
5. 重启 DSH 后数据仍在（不是内存降级）；
6. 禁用 bundle → UI 消失、部署默认人设恢复；重新启用 → 数据仍在。

### 6.2 git URL（push 之后才可用）

```powershell
# 普通 PowerShell（非管理员）
dsh plugin --profile <profile-name> add https://github.com/hxql666/dsh-persona-manager.git
```

重复 6.1 的验证清单。建议在干净 profile 上做一次，确认从零安装可用；测完移除 bundle 行即可。

## 7. 回滚

- **npm 发布有误**：优先 `npm deprecate "@hxql/dsh-persona-manager@0.1.0" "原因"` 提示使用者，然后发布修复版本。npm 对删除已发布版本有严格限制（通常只在发布后很短窗口内允许），**不要把 unpublish 当常规回滚手段**；确需删除时先读 npm 官方文档并评估依赖者影响。
- **tag / Release 有误**：Release 可在 GitHub 网页编辑或删除；tag 若尚未被外部引用，可删本地与远端 tag（`git push origin :refs/tags/v0.1.0`）后重打。已被 npm 版本对应的 tag 不建议移动。
- **安装侧回滚**：把 profile 的 bundle 换回上一版本（本地路径或上一个 git ref），数据文件保留即可继续用。
- **数据侧回滚**：0.1.0 没有迁移逻辑；禁用插件后先备份 `$DSH_HOME/storages/persona_manager.json`，必要时删除让插件重新初始化（会丢失历史人设，务必先备份）。
- **文档状态回滚**：一旦执行过发布 / push，`README.md`、`README_EN.md` 顶部的「尚未发布」说明与 `CHANGELOG.md` 的状态说明必须同步更新；若撤销发布，这些状态也要改回。

## 8. 发布后必做

- [ ] 更新 `README.md`、`README_EN.md` 顶部状态（改为已发布，补 npm / 仓库链接）；
- [ ] 更新 `CHANGELOG.md` 顶部状态与发布日期；
- [ ] `npm view` 与 GitHub Release 均可见；
- [ ] 用 git URL 在一个干净 profile 上复测安装；
- [ ] 记录发布结果（版本、日期、tag、npm dist-tag）。

---

**再重申一次**：以上步骤当前**一项都尚未执行**——本地既没有 publish，也没有 push，也没有 tag。可以放心继续修改代码与文档；每次准备发布前，从 §2 重新跑一遍检查。
