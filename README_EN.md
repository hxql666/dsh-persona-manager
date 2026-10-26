# DSH Persona Manager

> Create, save, and freely switch between multiple "persona prompts" in DeepSeek Harness: one global default plus a per-session temporary override.
> The plugin takes over the system-prompt persona prefix slot `deployment:persona-prefix` (order 0), actually replacing the deployment persona.

**Document language**: [简体中文](README.md) (primary) · English

[![npm version](https://img.shields.io/npm/v/@hxql/dsh-persona-manager)](https://www.npmjs.com/package/@hxql/dsh-persona-manager) [![GitHub release](https://img.shields.io/github/v/release/hxql666/dsh-persona-manager?display_name=release&sort=semver)](https://github.com/hxql666/dsh-persona-manager/releases) [![License: MIT](https://img.shields.io/github/license/hxql666/dsh-persona-manager)](LICENSE) [![Tests: 92 passing](https://img.shields.io/badge/tests-93%20passing-brightgreen)](test/)

| Item | Value |
|---|---|
| npm package | `@hxql/dsh-persona-manager` |
| Version | `0.1.3` |
| License | MIT, see [LICENSE](LICENSE) |
| Repository | `https://github.com/hxql666/dsh-persona-manager` (open source) |
| Design contract | [docs/DESIGN.md](docs/DESIGN.md) (the sole source of truth for behavior) |
| Changelog | [CHANGELOG.md](CHANGELOG.md) |
| Publishing guide | [docs/PUBLISH.md](docs/PUBLISH.md) |

> **Current status**: 0.1.3 is open-sourced on GitHub ([v0.1.3 release](https://github.com/hxql666/dsh-persona-manager/releases/tag/v0.1.3)) and published to npm ([`@hxql/dsh-persona-manager`](https://www.npmjs.com/package/@hxql/dsh-persona-manager)).
> **0.1.3 fixes a cold-start race**: the plugin now declares `storageDomain` as a required dependency, so Cordis activates it only after the storage service is mounted. Previously a cold start could fall back to the in-memory store, making saved personas "disappear" and showing only the freshly seeded default. 0.1.2 was the API trust-fence security release.
> All three installation routes work: npm package name, the GitHub repository, or a local directory (Plugin Manager or command line). See [docs/PUBLISH.md](docs/PUBLISH.md) for the release flow.

## Contents

1. [What it does](#1-what-it-does)
2. [Environment and Host service requirements](#2-environment-and-host-service-requirements)
3. [Installation](#3-installation)
4. [Where to find it](#4-where-to-find-it)
5. [Quick start](#5-quick-start)
6. [Usage and semantics](#6-usage-and-semantics)
7. [Persona fields and validation](#7-persona-fields-and-validation)
8. [Data storage](#8-data-storage)
9. [How the persona reaches the model](#9-how-the-persona-reaches-the-model)
10. [Safety boundaries](#10-safety-boundaries)
11. [Relationship with AGENTS.md (takeover note)](#11-relationship-with-agentsmd-takeover-note)
12. [HTTP API (advanced)](#12-http-api-advanced)
13. [Uninstall and rollback](#13-uninstall-and-rollback)
14. [Troubleshooting](#14-troubleshooting)
15. [Development and tests](#15-development-and-tests)
16. [Version and non-goals](#16-version-and-non-goals)
17. [License and links](#17-license-and-links)

> All commands below are run in a **normal PowerShell (non-administrator)** session.

## 1. What it does

- **Multi-persona CRUD**: create, edit and delete personas; each persona has a name, description, body (the persona prompt), emoji and color.
- **Free switching**: a global default (the default for all sessions) plus per-session overrides (temporarily switch a single session, and switch back to "follow global" at any time).
- **Persona prefix slot takeover**: registers the persona body in the system prompt's `deployment:persona-prefix` slot (order 0), replacing the deployment persona; when no persona is selected the slot is empty and still shadows the deployment default (see section 9).
- **Two entry points**: the persona settings page (list / create / edit / delete / set global default) and the persona chip in the composer toolbar (shows the current persona + quick switching).
- **Silent activation**: switching a persona inserts nothing into the conversation; it takes effect on the next model request (see sections 6 and 9).
- **Built-in seed persona**: the first initialization writes one example persona (Whale Girl 🐋) and sets it as the global default; it is not re-seeded after the user deletes everything.
- **Official storage**: data uses DSH's official JSON storage backend and lands in `$DSH_HOME/storages/persona_manager.json`; when storage is unavailable the plugin degrades to in-memory storage and still loads.

**v1 non-goals**: slash commands, persona tools exposed to the model, JSON/Markdown import/export, workspace-level persona files, stacking multiple personas, SSE real-time push (the client re-fetches state after its own writes). See section 16.

## 2. Environment and Host service requirements

- Runs on a DeepSeek Harness that provides the **`systemPrompt`** service (desktop app or Web GUI).
- Pure-JS workspace bundle: Host entry `index.js`, single-file browser module `client.js`, **no build step and no third-party runtime dependencies** (React is provided by the host).
- `package.json` declares `engines.node >= 18`; the plugin is loaded by the DSH host runtime, so no extra dependency installation is required.
- The client is configured as `platform: 'web'` under `dsh.client`; the settings section and composer toolbar need the Web UI, while headless (CLI) scenarios can still use persistence and persona injection.

The plugin depends on Host services as follows (`inject` contains only `systemPrompt`; everything else is optional and degrades when missing):

| Host service | Requirement | Role and consequence when missing |
|---|---|---|
| `systemPrompt` | **Required** (hard dependency) | Registers the persona prompt section; without it the plugin does not load and the settings page, chip and HTTP API all stay absent |
| `storageDomain` | **Required** (declared in `inject`) | Persists through the official `@deepseek-ai/dsh-storage-json` backend. Cordis activates the plugin only after this service is mounted (fixes the cold-start race); only a real `open()` failure (backend mismatch / corrupt data file) degrades to **in-memory storage** with one `logger.error`, which loses data on restart |
| `agents` | Optional | Backfills the persona section for agents that already existed before the plugin was mounted; when missing only agents created after mounting (`agent/created`) are handled |
| `webServer` | Needed only for the UI (optional for the plugin) | Registers the `/persona-manager/api` HTTP routes used by the client UI; when missing the routes are not registered, while persistence and persona injection keep working but the settings page and chip cannot fetch data |

Coexistence with `@deepseek-ai/dsh-persona`: the plugin **never modifies or removes** that preset's registrations; when the slot is occupied within the same agent scope it falls back (see section 9).

## 3. Installation

Install this directory into the target DSH profile as a **bundle**, using one of two methods.

### Option 1: install the bundle with the Plugin Manager

Install this bundle through DSH's Plugin Manager (the `plugin_manager install_bundle` acceptance path in the contract). The bundled `cordis.patch.yml` does exactly one thing: it inserts one Host plugin row into the profile's plugin composition (id `persona-manager`, name `@hxql/dsh-persona-manager`).

### Option 2: install from the command line

```powershell
# Normal PowerShell (non-administrator)
# Install from npm (recommended)
dsh plugin --profile <profile-name> add @hxql/dsh-persona-manager

# Install from the GitHub repository
dsh plugin --profile <profile-name> add https://github.com/hxql666/dsh-persona-manager.git

# Install from a local directory (development / offline)
dsh plugin --profile <profile-name> add <local-path>\dsh-persona-manager
```

Notes:

- Replace `<profile-name>` with the target DSH profile name; the command registers the plugin in that profile's plugin composition (the bundle row), equivalent to installing the bundle through the Plugin Manager.
- The command modifies that profile's plugin configuration as expected—this is normal installation behavior.
- After installing, **restarting the DSH app is recommended** before verifying (so the new plugin modules are loaded).

Signs of a successful install: in a new session, Settings contains the Personas page (人设管理), the composer toolbar shows the persona chip, and the first initialization writes the seed persona.

> The `dsh plugin ... add` command above comes from this project's release convention; the contract [docs/DESIGN.md](docs/DESIGN.md) only fixes the Plugin Manager `install_bundle` acceptance path. Both methods install the same bundle.

## 4. Where to find it

The plugin registers two client slots (`client.js`, single file, no build):

| Slot | Component | Contents |
|---|---|---|
| `settings.section` | Persona management page (order 30) | persona list / create / edit / delete / set global default |
| `conversation.input.left` | persona chip (order 10) | shows the current persona; click to open the "this session" switching popover |

- **Settings page**: Settings → **Personas** (人设管理 in the Chinese UI; the plugin's metadata title in the Plugin Manager is "Persona Manager").
- **Persona chip**: on the left side of the composer toolbar, showing "emoji + name"; when there is no effective persona it shows `🎭 Persona`.
- Popover contents: the "Persona for this session" heading → "Follow global (current: X)" → the persona list → "Set current persona as global default" at the bottom (disabled when there is no effective persona); a close control at the top right. Escape and click-outside close it.
- Each row in the settings list shows the emoji circle (background uses the persona's color, i.e. the `color` field), name, description, a "Global default" badge, and the `Set as global default` / `Edit` / `Delete` actions (delete requires two confirmations).
- All UI copy goes through locale (Chinese / English) and follows the DSH interface language.

## 5. Quick start

1. Install and enable the bundle, then open DSH. On first initialization the persona list is empty and no seed record exists, so the plugin writes the example persona "Whale Girl 🐋" and sets it as the global default.
2. Open Settings → Personas and click "New persona": enter a name, emoji, color (8 preset swatches or a custom color picker), description and body (the persona prompt), then save. The body is exactly the text injected into the system prompt.
3. Click "Set as global default" on the persona you want: every session without a per-session override will use it.
4. To change only one session: click the persona chip in the composer toolbar → pick a persona and that session switches immediately; pick "Follow global (current: X)" to clear the session override.
5. Switching is silent and inserts no chat line; the **next model request** carries the new persona body.

## 6. Usage and semantics

### 6.1 Global default vs per-session override

| State | Meaning in storage | Scope |
|---|---|---|
| Global default | `global.activePersonaId` points at a persona | every session without an explicit override |
| Per-session override | one `sessions` record for that `sessionId` | this session only |
| Follow global | the session has **no** `sessions` record | inherits the global default |
| Do not use a persona | the session record exists with `personaId: null` | this session explicitly uses no persona; it does not fall back to global |

"Follow global" and "do not use a persona" are different: the first removes the override and returns to global; the second keeps an explicit override that says this session wants no persona.

### 6.2 How the effective persona is resolved

The final persona for each session is resolved in this order (the `effectivePersonaId(sessionId)` contract):

| Situation | Effective persona |
|---|---|
| No session record | the global default (if it exists and the persona was not deleted) → otherwise none |
| Session record points at an existing persona | that persona |
| Session record has `personaId: null` | no persona (explicit) |
| Session record points at a deleted persona | fall back to the global default |
| Global default points at a deleted persona | no persona |

`sessionId` is the agent's `agent.id` (DSH's `SessionId`).

### 6.3 When changes take effect

- Each live agent registers the persona section once; the section's `text` is a function that **re-reads storage on every prompt assembly**. Switching a persona therefore needs no re-registration and no new session; it takes effect on the **next model request**.
- A subagent is an independent agent too: it **inherits only the global default** and not its parent session's override.
- Switching only writes storage, never the conversation: no extra "persona switched" message appears.

### 6.4 Deleting a persona

Deleting a persona also cleans up the places that reference it:

- every `sessions` record that used the persona as a session override gets `personaId` set to `null` (the explicit override is kept; it does not fall back to global);
- if the global default pointed at it, `global.activePersonaId` is set to `null`;
- The delete endpoint returns `ok`, `clearedGlobal` and `clearedSessions`; when the deleted persona was the global default, the settings page reports the cleanup.

Stale session records are not actively removed; they keep the explicit-override semantics described in 6.2.

### 6.5 Seed persona and "no re-seeding after deleting everything"

- On first initialization (`personas` is empty and `global.seeded !== true`) the plugin writes the seed persona "Whale Girl", sets it as the global default, and sets `global.seeded` to `true`.
- `seeded` is written only once: after the user deletes every persona, restarting does not inject the seed persona again.
- To replay first initialization, delete the data file (see section 13).

## 7. Persona fields and validation

Persona record (`personas` table, key = `persona.id`):

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

| Field | Required | Rule | Default |
|---|---|---|---|
| `name` | yes | 1–80 characters after trim | — |
| `body` | yes | 1–20000 characters after trim, newlines preserved | — |
| `description` | no | ≤300 characters | `""` |
| `emoji` | no | ≤8 UTF-16 code units | `"🎭"` |
| `color` | no | 6-digit hex color matching `^#[0-9a-fA-F]{6}$` | `"#6b7280"` |
| `id` | read-only | generated server-side only: `p_` + `Date.now().toString(36)` + 4 random characters, must match `[a-zA-Z0-9_-]+` | auto |
| `createdAt` / `updatedAt` | read-only | millisecond timestamps, written server-side only | auto |

- Unknown fields are dropped; any out-of-range value throws `PersonaValidationError` (`code: 'invalid-persona'`), mapped to `400 invalid-persona` at the HTTP layer.
- The frontend applies the same length validation as the server and shows errors; the emoji input is a single-line short input, and the color can be one of 8 preset swatches or a custom `<input type="color">`.

## 8. Data storage

Persona data uses DSH's official JSON storage backend `@deepseek-ai/dsh-storage-json`, with domain name `persona_manager`, single-file layout (`layout: 'single'`), at:

```
$DSH_HOME/storages/persona_manager.json
```

`$DSH_HOME` is the DSH data directory; on Windows it defaults to `%USERPROFILE%\.dsh`, i.e.:

```text
C:\Users\<user>\.dsh\storages\persona_manager.json
```

The unit file is maintained by the storage backend; its shape is illustrated below (persona record fields in section 7, session record fields in 6.1):

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

Field semantics:

- `global.activePersonaId`: the global default persona id, or `null`; `global.seeded`: whether first initialization has run (written only once).
- The `sessions` table key is `sessionId`; **no record = inherit the global default**, `personaId: null` = this session explicitly uses no persona.
- The storage domain is configured with `invalidRecords: 'backup-and-skip'`: invalid records encountered on read are backed up and skipped rather than preventing the whole domain from opening.

Degradation and manual maintenance:

- `storageDomain` is a required dependency: Cordis activates the plugin only after the storage service is ready. Only a real `open()` failure (backend mismatch / corrupt data file) is caught and degraded to **in-memory storage** with one `logger.error`; in that case data is lost when DSH restarts.
- To edit the file by hand: disable the plugin first (to avoid write races) and back up the original, then re-enable after editing. A malformed file or version mismatch may trigger degradation / backup-and-skip.

## 9. How the persona reaches the model

- Each live agent registers one system-prompt section:

  ```js
  {
    name: 'deployment:persona-prefix',
    order: 0,
    interpolate: false,
    text: () => store.effectivePersona(agent.id)?.body ?? ''
  }
  ```

  That is: the persona body enters the **persona prefix slot of the system prompt (order 0, near the front)**, replacing the deployment persona. `text` is evaluated on every assembly, so a switch takes effect on the next request.
- **`interpolate: false` is mandatory**: the persona body is injected as plain text without `{{…}}` template interpolation; otherwise braces in the body would make prompt assembly throw.
- **Semantics of an empty persona**: when the effective persona is `null`, `text` returns `''`; an empty section disappears at render time, but a scoped empty section **still shadows the deployment default persona**—so "do not use a persona" does not bring the deployment default back, which is the "plugin takes over" contract.
- **Conflict with `@deepseek-ai/dsh-persona`**: if `deployment:persona-prefix` is already occupied in the same agent scope by that preset, the registration throws; the plugin catches it, registers `persona-manager:persona` (order 1, also `interpolate: false`) instead, and logs one `logger.info`. In that case it no longer replaces the deployment slot; instead it injects additional persona text. The plugin never modifies or removes the other registrations.

**KV cache caveat**: the persona body sits in the leading system-prompt prefix slot. Switching personas changes the prompt prefix; if the upstream model/gateway enables prompt (KV) caching, cache reuse from the changed position onward is invalidated—the first request after a switch may be slower or costlier. This is inherent to prompt-prefix caching, not extra behavior of the plugin; frequent switching repeatedly breaks cache hits.

## 10. Safety boundaries

- **The persona only changes tone**: it does not change facts, does not alter the execution flow, and does not override safety boundaries. Code, commands, paths and error output keep their original form.
- **Risky actions still need confirmation**: deletions, overwrites, privilege escalation, registry/permission changes, and data exfiltration still require stating the risks and rollback plan and waiting for confirmation; a persona does not exempt those steps.
- **No out-of-scope writes**: the plugin does not modify `AGENTS.md` and does not modify or delete any `@deepseek-ai/dsh-persona` registration; it only writes its own storage domain and prompt section.
- **The persona body enters the system prompt**: the body is eventually sent to the model service with requests—**do not** treat it as a secret store; do not put tokens, passwords or private data in it.
- **Local HTTP API**: it only has Origin/Host same-origin validation (when an `Origin` header is present its host must equal the `Host` header, otherwise 403 `bad-origin`), a 1 MiB request-body limit, a method allowlist and an id charset restriction—**there is no login-style authentication**. Do not expose the DSH Web service to untrusted networks.

## 11. Relationship with AGENTS.md (takeover note)

What this plugin takes over is DSH's **persona prefix slot**, not a user-level instruction file. If `~/.dsh/AGENTS.md` still says "force-load persona X in every session", that is a **second, independent persona source**, which stacks with / conflicts with the persona injected by the plugin.

Following the contract's acceptance requirement, after installing and verifying that plugin injection works, it is recommended to handle it this way (**manually; the plugin never edits it**):

1. Back up `AGENTS.md`:

   ```powershell
   # Normal PowerShell (non-administrator)
   Copy-Item "$env:USERPROFILE\.dsh\AGENTS.md" "$env:USERPROFILE\.dsh\AGENTS.md.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
   ```

2. Edit `~/.dsh/AGENTS.md` and remove the **forced loading requirement** from the "persona loading (default for every session)" section, keeping the persona boundary clauses (do not change facts/flow/safety boundaries, etc.).
3. Open a new session and confirm the tone comes from the effective persona selected in the plugin.

**Rollback**: copy the backup back to `AGENTS.md` to restore the previous forced-loading behavior:

```powershell
# Normal PowerShell (non-administrator); replace <timestamp> with the actual backup name
Copy-Item "$env:USERPROFILE\.dsh\AGENTS.md.bak-<timestamp>" "$env:USERPROFILE\.dsh\AGENTS.md" -Force
```

## 12. HTTP API (advanced)

The client UI talks to Host routes through same-origin relative paths under the prefix `/persona-manager/api` (`kind: 'prefix'`). Every response is `Content-Type: application/json; charset=utf-8` with `Cache-Control: no-store`.

This route serves only this plugin's browser UI: every request first passes the DSH Connection trust fence (Host must be the local listener, the Origin must match, and the browser cookie must be valid). A non-local Host is rejected with 403 `untrusted`; a request without browser credentials gets 401 `unauthenticated`. It is not a public API, and a bare command-line call is refused.

| Method | Path | Request body | Success response |
|---|---|---|---|
| GET | `/state?sessionId=<optional>` | — | `{ version: 1, personas: [...], global: { activePersonaId }, session: { personaId } \| null, effectivePersonaId }` |
| POST | `/personas` | `{ name, body, description?, emoji?, color? }` | `201 { persona }` |
| PUT | `/personas/<id>` | any subset of the fields above | `200 { persona }` |
| DELETE | `/personas/<id>` | — | `200 { ok: true, clearedGlobal, clearedSessions }` |
| POST | `/switch` | `{ scope: 'global' \| 'session', sessionId?, personaId: string \| null }` | `200 { ok: true, effectivePersonaId }` |

Constraints and errors:

- `scope: 'session'` requires a non-empty `sessionId`; an existing persona id writes a session override, while `personaId: null` **clears the override and follows the global default again** (the record is deleted). The store still keeps an "explicitly no persona" record semantic; it only appears in the cascade cleanup after a persona deletion.
- `scope: 'global'` with `personaId: null` clears the global default (every session without an override falls back to "no persona").
- `personas` are returned in `createdAt` ascending order (old → new); display order is up to the client.
- Errors are uniformly `{ error: { code, message } }`: 400 `invalid-json` / `invalid-body` / `invalid-persona`, 401 `unauthenticated`, 403 `bad-origin` / `untrusted`, 404 `not-found` / `persona-not-found`, 405 `method-not-allowed`, 413 `payload-too-large`, 500 `internal`.
- Security: the request first passes the DSH Connection trust fence (DNS-rebinding / cross-site protection; failures are 401/403), then only GET/POST/PUT/DELETE are accepted (others 405); the `Origin` host must equal `Host` (defense in depth, otherwise 403 `bad-origin`); request bodies are capped at 1 MiB; path-parameter ids may only match `[a-zA-Z0-9_-]+`; unknown subpaths return 404.

Calling convention (page use only):

```text
GET /persona-manager/api/state
```

> A bare command-line call (e.g. `Invoke-RestMethod`) has no page cookie and gets 401 `unauthenticated`; copy the request headers from the browser DevTools when debugging.

## 13. Uninstall and rollback

- **Uninstall / disable**: disable or remove this bundle's plugin row in the Plugin Manager (or the profile's plugin composition). Personas are no longer injected, the settings page and chip disappear, the `/persona-manager/api` routes are no longer registered, and the deployment default persona takes effect again (the plugin never modified it).
- **Data retained**: the data file `$DSH_HOME/storages/persona_manager.json` is not deleted automatically; it can be reused after reinstalling.
- **Full reset**: disable the plugin first (to avoid write races) → back up or delete `$DSH_HOME/storages/persona_manager.json` → re-enable / restart. After deletion, first initialization writes the seed persona again.
- **Roll back to an older version**: reinstall the previous version's local path / git tag into the same profile's bundle; keeping the data file lets it continue to work.
- **Restore AGENTS.md**: if you changed it per section 11, copy `AGENTS.md.bak-<timestamp>` back.

## 14. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| No Personas page in Settings and no persona chip in the composer | the bundle is not enabled; or the profile has no `webServer` (the UI and API depend on it) | confirm the bundle row is enabled and restart DSH; confirm the Host provides `webServer` |
| The settings page appears but the list never loads / `/persona-manager/api/state` returns 404 | the Host side of the plugin did not load (e.g. the required `systemPrompt` is missing), or the HTTP routes were not registered | check the Host log; confirm the `systemPrompt` service exists |
| Data is lost after restarting DSH, or only the default persona is listed | 0.1.2 and older could mount before the storage service was ready and degraded to the in-memory store (fixed in 0.1.3) | upgrade to 0.1.3+ and restart; the data file is still at `$DSH_HOME/storages/persona_manager.json`, no need to re-add personas |
| A switched persona does not change the model output | only storage was changed and it takes effect on the **next request**; or the session was explicitly set to "do not use a persona" | send the next message and check again; verify the chip shows the persona you expect |
| The persona body does not appear in the system prompt / the tone does not change | `deployment:persona-prefix` is already occupied by `@deepseek-ai/dsh-persona` in the same scope, so the plugin used the `persona-manager:persona` fallback (the log has a `logger.info`); or `AGENTS.md` still forces a persona, stacking two sources | check the log and any other preset/plugin that injects a persona; handle `AGENTS.md` per section 11 |
| The API returns 403 `bad-origin` | the request carried an `Origin` header whose host differs from `Host` (common behind reverse proxies) | connect to the DSH Web service directly on the machine, or keep Host/Origin consistent on the proxy |
| The API returns 413 `payload-too-large` | the request body exceeds 1 MiB | the persona body limit is 20000 characters, so normal use never triggers it; check the caller |
| The API returns 400 `invalid-persona` | name/body empty or too long, description over 300 characters, emoji over 8 UTF-16 code units, color not `#rrggbb` | fix per the validation rules in section 7 |
| Want to start completely over | historical data exists in storage | delete the data file per section 13 and let first initialization run again |

## 15. Development and tests

- Layout (pure JS, no build, no dependencies):

  ```text
  index.js          Host entry (export name / inject / apply)
  lib/host/*.js     Host implementation (store / seed / prompt / http / http-util)
  client.js         single-file browser module (settings page + persona chip)
  test/*.mjs        Host tests (node --test); the client side gets static/pure-function checks only
  cordis.patch.yml  bundle patch (inserts one Host plugin row)
  locale/*.json     plugin metadata copy (zh / en)
  docs/DESIGN.md    design contract (sole source of truth)
  ```

- Commands (normal PowerShell, non-administrator; Node ≥ 18):

  ```powershell
  npm test                 # = node --test test/
  node --check index.js    # syntax check; likewise for lib/ and client.js
  ```

- This project has no dependencies; **`npm install` is not needed**. All JS should pass `node --check` and `npm test` should pass.
- Read [docs/DESIGN.md](docs/DESIGN.md) before changing behavior; the release process is in [docs/PUBLISH.md](docs/PUBLISH.md).

## 16. Version and non-goals

Current version **0.1.3** (see [CHANGELOG.md](CHANGELOG.md)); open-sourced on GitHub and published to npm.

v1 explicitly does **not** do (see section 1 of the contract):

- slash commands;
- persona tools exposed to the model;
- JSON / Markdown import and export;
- workspace-level persona files;
- stacking multiple personas;
- SSE real-time push (the client re-fetches `/state` after its own writes).

## 17. License and links

- License: **MIT**, Copyright (c) 2026 hxql; full text in [LICENSE](LICENSE).
- Repository: `https://github.com/hxql666/dsh-persona-manager` (open source).
- Package name / npm: `@hxql/dsh-persona-manager` — https://www.npmjs.com/package/@hxql/dsh-persona-manager
- Related docs: [design contract](docs/DESIGN.md) · [publishing guide](docs/PUBLISH.md) · [changelog](CHANGELOG.md) · [简体中文 README](README.md).

---

This README and [README.md](README.md) have a one-to-one section structure; every technical fact follows [docs/DESIGN.md](docs/DESIGN.md) as the sole contract, and the version and package information follow `package.json`.
