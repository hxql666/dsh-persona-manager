/**
 * Persona Manager — Web client half.
 *
 * Plain browser JavaScript in the official dynamic-module format. No build step,
 * no third-party imports: React comes from the browser module table.
 *
 * Registers two slot occupants:
 *   - settings.section          -> PersonaSettingsSection (id "persona-manager", order 30)
 *   - conversation.input.left   -> PersonaChip            (id "persona-manager", order 10)
 *
 * All host data goes through the same-origin JSON API under /persona-manager/api.
 * Every write refetches /state. Visible copy lives in the zh/en locale
 * dictionaries below; the components re-render on locale changes through the
 * locale snapshot subscription.
 */
window.__ModuleLoader__.load({
  id: '@hxql/dsh-persona-manager',
  factory(require) {
    'use strict'

    const React = require('react')
    const h = React.createElement

    const NS = 'persona-manager'
    const API_BASE = '/persona-manager/api'
    const DEFAULT_EMOJI = '🎭'
    const DEFAULT_COLOR = '#6b7280'
    const COLOR_PRESETS = [
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#ef4444',
      '#f59e0b',
      '#10b981',
      '#06b6d4',
      '#6b7280',
    ]
    const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
    const MAX_NAME = 80
    const MAX_BODY = 20000
    const MAX_DESCRIPTION = 300
    const MAX_EMOJI = 8

    const ERROR_KEYS = {
      'invalid-json': 'error.invalid-json',
      'invalid-body': 'error.invalid-body',
      'invalid-persona': 'error.invalid-persona',
      'not-found': 'error.not-found',
      'persona-not-found': 'error.persona-not-found',
      'method-not-allowed': 'error.method-not-allowed',
      'payload-too-large': 'error.payload-too-large',
      'bad-origin': 'error.bad-origin',
      internal: 'error.internal',
      network: 'error.network',
    }

    // ---------------------------------------------------------------------
    // Locale dictionaries (the only place with user-visible copy).
    // ---------------------------------------------------------------------
    const DICT = {
      zh: {
        navLabel: '人设管理',
        settingsTitle: '人设管理',
        settingsDesc: '创建、编辑并切换人设。每个会话可使用自己的覆盖，未覆盖时跟随全局默认。',
        personaCount: '共 {count} 个人设',
        addPersona: '新增人设',
        refresh: '刷新',
        retry: '重试',
        loading: '加载中…',
        emptyList: '还没有人设。点击「新增人设」创建第一个。',
        globalBadge: '全局默认',
        setGlobal: '设为全局默认',
        edit: '编辑',
        delete: '删除',
        confirmDelete: '确定删除「{name}」？',
        confirm: '确认删除',
        cancel: '取消',
        save: '保存',
        saving: '保存中…',
        createTitle: '新增人设',
        editTitle: '编辑人设',
        fieldName: '名称',
        fieldEmoji: 'Emoji',
        fieldColor: '颜色',
        fieldDescription: '简介',
        fieldBody: '人设正文',
        hintName: '必填，1–80 个字符',
        hintEmoji: '最多 8 个字符，留空时使用 🎭',
        hintDescription: '可选，最多 300 个字符',
        hintBody: '必填，1–20000 个字符，保留换行',
        colorCustom: '自定义颜色',
        presetColor: '预设颜色 {index}',
        errorName: '名称不能为空，且不超过 80 个字符。',
        errorBody: '人设正文不能为空，且不超过 20000 个字符。',
        errorDescription: '简介不能超过 300 个字符。',
        errorEmoji: 'Emoji 不能超过 8 个字符。',
        errorColor: '颜色必须是 #RRGGBB 格式。',
        editorInvalid: '请修正标红的字段后再保存。',
        created: '人设已创建。',
        saved: '人设已保存。',
        deleted: '人设已删除。',
        deletedClearedGlobal: '人设已删除，全局默认已清除。',
        globalSet: '已设为全局默认。',
        noDescription: '无简介',
        close: '关闭',
        chipFallback: '人设',
        chipTitle: '本会话人设',
        chipAria: '切换本会话人设',
        followGlobalCurrent: '跟随全局（当前：{name}）',
        noPersona: '未设置',
        sessionExplicitNone: '本会话已选择不使用人设。',
        setCurrentAsGlobal: '将当前人设设为全局默认',
        alreadyGlobal: '已是全局默认',
        noSession: '当前没有活动会话',
        errorLoad: '无法加载人设数据。',
        'error.invalid-json': '请求格式无效。',
        'error.invalid-body': '请求体无效。',
        'error.invalid-persona': '人设内容不符合要求，请检查各字段。',
        'error.not-found': '目标不存在。',
        'error.persona-not-found': '人设不存在，可能已被删除。',
        'error.method-not-allowed': '不支持的请求方法。',
        'error.payload-too-large': '内容过大，无法保存。',
        'error.bad-origin': '请求来源不受信任。',
        'error.internal': '服务器内部错误。',
        'error.network': '无法连接到宿主服务，请确认插件已启用。',
        'error.http': '请求失败（HTTP {status}）。',
        'error.unknown': '请求失败（{code}）。',
      },
      en: {
        navLabel: 'Personas',
        settingsTitle: 'Persona management',
        settingsDesc:
          'Create, edit, and switch personas. Each session can use its own override; without one it follows the global default.',
        personaCount: '{count} personas',
        addPersona: 'New persona',
        refresh: 'Refresh',
        retry: 'Retry',
        loading: 'Loading…',
        emptyList: 'No personas yet. Choose “New persona” to create the first one.',
        globalBadge: 'Global default',
        setGlobal: 'Set as global default',
        edit: 'Edit',
        delete: 'Delete',
        confirmDelete: 'Delete “{name}”?',
        confirm: 'Confirm delete',
        cancel: 'Cancel',
        save: 'Save',
        saving: 'Saving…',
        createTitle: 'New persona',
        editTitle: 'Edit persona',
        fieldName: 'Name',
        fieldEmoji: 'Emoji',
        fieldColor: 'Color',
        fieldDescription: 'Description',
        fieldBody: 'Persona text',
        hintName: 'Required, 1–80 characters',
        hintEmoji: 'Up to 8 characters; defaults to 🎭 when empty',
        hintDescription: 'Optional, up to 300 characters',
        hintBody: 'Required, 1–20000 characters; line breaks are preserved',
        colorCustom: 'Custom color',
        presetColor: 'Preset color {index}',
        errorName: 'Name is required and must be at most 80 characters.',
        errorBody: 'Persona text is required and must be at most 20000 characters.',
        errorDescription: 'Description must be at most 300 characters.',
        errorEmoji: 'Emoji must be at most 8 characters.',
        errorColor: 'Color must be in #RRGGBB format.',
        editorInvalid: 'Fix the highlighted fields before saving.',
        created: 'Persona created.',
        saved: 'Persona saved.',
        deleted: 'Persona deleted.',
        deletedClearedGlobal: 'Persona deleted; the global default was cleared.',
        globalSet: 'Global default updated.',
        noDescription: 'No description',
        close: 'Close',
        chipFallback: 'Persona',
        chipTitle: 'Persona for this session',
        chipAria: 'Change the persona for this session',
        followGlobalCurrent: 'Follow global (current: {name})',
        noPersona: 'None',
        sessionExplicitNone: 'This session is set to use no persona.',
        setCurrentAsGlobal: 'Set current persona as global default',
        alreadyGlobal: 'Already the global default',
        noSession: 'No active session',
        errorLoad: 'Could not load persona data.',
        'error.invalid-json': 'Invalid request format.',
        'error.invalid-body': 'Invalid request body.',
        'error.invalid-persona': 'Persona data is invalid; check the fields.',
        'error.not-found': 'Not found.',
        'error.persona-not-found': 'That persona no longer exists.',
        'error.method-not-allowed': 'Request method not allowed.',
        'error.payload-too-large': 'Content is too large to save.',
        'error.bad-origin': 'Request origin is not trusted.',
        'error.internal': 'Internal server error.',
        'error.network': 'Cannot reach the host service. Make sure the plugin is enabled.',
        'error.http': 'Request failed (HTTP {status}).',
        'error.unknown': 'Request failed ({code}).',
      },
    }

    // ---------------------------------------------------------------------
    // Component-local stylesheets. Only host theme tokens carry color; the
    // persona color is applied inline on the emoji circle / option dot.
    // ---------------------------------------------------------------------
    const SETTINGS_CSS = [
      '.dsh-pm-settings{display:flex;flex-direction:column;gap:12px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;padding:4px 2px 20px;}',
      '.dsh-pm-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;}',
      '.dsh-pm-head-main{flex:1 1 260px;min-width:0;}',
      '.dsh-pm-title{margin:0;font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.dsh-pm-desc{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);max-width:52em;}',
      '.dsh-pm-head-actions{display:flex;gap:6px;flex-wrap:wrap;}',
      '.dsh-pm-muted{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.dsh-pm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:4px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.4;cursor:pointer;}',
      '.dsh-pm-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}',
      '.dsh-pm-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.dsh-pm-btn:disabled{opacity:.5;cursor:not-allowed;}',
      '.dsh-pm-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}',
      '.dsh-pm-btn-danger{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}',
      '.dsh-pm-notice{padding:6px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;}',
      '.dsh-pm-notice-success{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);}',
      '.dsh-pm-notice-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary);}',
      '.dsh-pm-list{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none;}',
      '.dsh-pm-row{display:flex;align-items:flex-start;gap:10px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}',
      '.dsh-pm-avatar{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;font-size:16px;line-height:1;flex:none;color:var(--dsw-alias-label-primary);}',
      '.dsh-pm-row-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:3px;}',
      '.dsh-pm-name{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600;overflow-wrap:anywhere;}',
      '.dsh-pm-badge{padding:0 6px;border-radius:999px;border:1px solid var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-size:11px;font-weight:400;line-height:1.6;}',
      '.dsh-pm-desc-text{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;overflow-wrap:anywhere;}',
      '.dsh-pm-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center;flex:none;max-width:46%;}',
      '.dsh-pm-confirm-text{font-size:12px;color:var(--dsw-alias-state-error-primary);}',
      '.dsh-pm-empty{display:flex;flex-direction:column;gap:8px;align-items:flex-start;padding:12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:8px;}',
      '.dsh-pm-loading{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.dsh-pm-form{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);}',
      '.dsh-pm-form-title{margin:0;font-size:14px;font-weight:600;}',
      '.dsh-pm-field{display:flex;flex-direction:column;gap:4px;min-width:0;}',
      '.dsh-pm-label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary);}',
      '.dsh-pm-input,.dsh-pm-textarea{box-sizing:border-box;width:100%;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;}',
      '.dsh-pm-input:focus,.dsh-pm-textarea:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;border-color:var(--dsw-alias-brand-primary);}',
      '.dsh-pm-textarea{resize:vertical;min-height:200px;}',
      '.dsh-pm-textarea-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.45;min-height:220px;}',
      '.dsh-pm-hint{font-size:11px;color:var(--dsw-alias-label-secondary);}',
      '.dsh-pm-error{font-size:12px;color:var(--dsw-alias-state-error-primary);}',
      '.dsh-pm-invalid{border-color:var(--dsw-alias-state-error-primary);}',
      '.dsh-pm-colors{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}',
      '.dsh-pm-swatch{width:22px;height:22px;padding:0;border-radius:50%;border:2px solid var(--dsw-alias-border-l1);cursor:pointer;}',
      '.dsh-pm-swatch[aria-pressed="true"]{border-color:var(--dsw-alias-label-primary);}',
      '.dsh-pm-color-input{width:34px;height:26px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:var(--dsw-alias-bg-base);cursor:pointer;}',
      '.dsh-pm-color-value{font-size:12px;color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}',
      '.dsh-pm-form-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;}',
    ].join('\n')

    const CHIP_CSS = [
      '.dsh-pm-chip-wrap{position:relative;display:inline-flex;align-items:center;}',
      '.dsh-pm-chip{display:inline-flex;align-items:center;gap:5px;max-width:200px;padding:3px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;cursor:pointer;}',
      '.dsh-pm-chip:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}',
      '.dsh-pm-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.dsh-pm-chip:disabled{opacity:.5;cursor:not-allowed;}',
      '.dsh-pm-chip[aria-expanded="true"]{border-color:var(--dsw-alias-brand-primary);}',
      '.dsh-pm-chip-emoji{font-size:14px;line-height:1;flex:none;}',
      '.dsh-pm-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsh-pm-chip-caret{font-size:10px;line-height:1;color:var(--dsw-alias-label-secondary);flex:none;}',
      '.dsh-pm-popover{position:fixed;z-index:1000;display:flex;flex-direction:column;gap:8px;overflow-y:auto;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;}',
      '.dsh-pm-popover-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}',
      '.dsh-pm-popover-title{font-weight:600;}',
      '.dsh-pm-icon-btn{padding:0 6px;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:15px;line-height:1.5;cursor:pointer;}',
      '.dsh-pm-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}',
      '.dsh-pm-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.dsh-pm-options{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none;}',
      '.dsh-pm-option-item{margin:0;padding:0;}',
      '.dsh-pm-option{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:1.5;text-align:left;cursor:pointer;}',
      '.dsh-pm-option:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}',
      '.dsh-pm-option[aria-selected="true"]{border-color:var(--dsw-alias-brand-primary);}',
      '.dsh-pm-option:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}',
      '.dsh-pm-option:disabled{opacity:.5;cursor:not-allowed;}',
      '.dsh-pm-option-dot{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;border:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:1;flex:none;color:var(--dsw-alias-label-primary);}',
      '.dsh-pm-option-main{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '.dsh-pm-option-check{flex:none;color:var(--dsw-alias-brand-primary);}',
      '.dsh-pm-divider{height:1px;margin:2px 0;border:0;background:var(--dsw-alias-border-l1);}',
      '.dsh-pm-popover-global{width:100%;justify-content:center;}',
    ].join('\n')

    // ---------------------------------------------------------------------
    // Pure helpers. Kept free of React and of any ambient DOM access.
    // ---------------------------------------------------------------------
    function logWarn(message, error) {
      if (typeof console === 'undefined' || !console || typeof console.warn !== 'function') return
      console.warn('[persona-manager] ' + message, error)
    }

    function makeApiError(code, status, message) {
      const error = new Error(message || code)
      error.name = 'PersonaApiError'
      error.code = code
      if (typeof status === 'number') error.status = status
      return error
    }

    function requestJson(method, path, body) {
      const init = {
        method: method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      }
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(API_BASE + path, init).then(
        function (response) {
          return response.text().then(function (text) {
            let payload = null
            if (text) {
              try {
                payload = JSON.parse(text)
              } catch (parseError) {
                payload = null
              }
            }
            if (!response.ok) {
              const envelope = payload && typeof payload === 'object' ? payload.error : null
              const code =
                envelope && typeof envelope.code === 'string' && envelope.code
                  ? envelope.code
                  : 'http'
              const message =
                envelope && typeof envelope.message === 'string' ? envelope.message : ''
              throw makeApiError(code, response.status, message)
            }
            return payload
          })
        },
        function (networkError) {
          logWarn('request failed', networkError)
          throw makeApiError(
            'network',
            0,
            networkError && networkError.message ? networkError.message : 'network error',
          )
        },
      )
    }

    function describeError(t, error) {
      if (!error || typeof error !== 'object') return t('error.unknown', { code: 'unknown' })
      const code = typeof error.code === 'string' && error.code ? error.code : 'unknown'
      if (code === 'http') {
        return t('error.http', { status: typeof error.status === 'number' ? error.status : 0 })
      }
      const key = ERROR_KEYS[code]
      if (key) return t(key)
      return t('error.unknown', { code: code })
    }

    function safeColor(value) {
      return typeof value === 'string' && COLOR_PATTERN.test(value) ? value : DEFAULT_COLOR
    }

    function personaEmoji(persona) {
      if (persona && typeof persona.emoji === 'string' && persona.emoji) return persona.emoji
      return DEFAULT_EMOJI
    }

    function isPersonaLike(value) {
      return Boolean(value) && typeof value === 'object' && typeof value.id === 'string' && value.id !== ''
    }

    function normalizePersona(value) {
      return {
        id: value.id,
        name: typeof value.name === 'string' ? value.name : '',
        description: typeof value.description === 'string' ? value.description : '',
        body: typeof value.body === 'string' ? value.body : '',
        emoji: typeof value.emoji === 'string' && value.emoji ? value.emoji : DEFAULT_EMOJI,
        color: safeColor(value.color),
        createdAt: typeof value.createdAt === 'number' ? value.createdAt : 0,
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      }
    }

    function normalizeState(raw) {
      const source = raw && typeof raw === 'object' ? raw : {}
      const personas = Array.isArray(source.personas)
        ? source.personas.filter(isPersonaLike).map(normalizePersona)
        : []
      personas.sort(function (left, right) {
        return left.createdAt - right.createdAt
      })
      const rawGlobal = source.global && typeof source.global === 'object' ? source.global : null
      const globalActive =
        rawGlobal && typeof rawGlobal.activePersonaId === 'string' ? rawGlobal.activePersonaId : null
      let session = null
      if (source.session && typeof source.session === 'object') {
        session = {
          personaId:
            typeof source.session.personaId === 'string' ? source.session.personaId : null,
        }
      }
      return {
        version: typeof source.version === 'number' ? source.version : 1,
        personas: personas,
        global: { activePersonaId: globalActive },
        session: session,
        effectivePersonaId:
          typeof source.effectivePersonaId === 'string' ? source.effectivePersonaId : null,
      }
    }

    function findPersona(personas, id) {
      if (!id || !Array.isArray(personas)) return null
      for (let index = 0; index < personas.length; index += 1) {
        if (personas[index].id === id) return personas[index]
      }
      return null
    }

    function draftFromPersona(persona) {
      if (!persona) {
        return {
          name: '',
          emoji: DEFAULT_EMOJI,
          color: DEFAULT_COLOR,
          description: '',
          body: '',
        }
      }
      return {
        name: typeof persona.name === 'string' ? persona.name : '',
        emoji: typeof persona.emoji === 'string' && persona.emoji ? persona.emoji : DEFAULT_EMOJI,
        color: safeColor(persona.color),
        description: typeof persona.description === 'string' ? persona.description : '',
        body: typeof persona.body === 'string' ? persona.body : '',
      }
    }

    function validateDraft(draft) {
      const errors = {}
      const name = typeof draft.name === 'string' ? draft.name.trim() : ''
      if (name.length < 1 || name.length > MAX_NAME) errors.name = 'errorName'
      const body = typeof draft.body === 'string' ? draft.body.trim() : ''
      if (body.length < 1 || body.length > MAX_BODY) errors.body = 'errorBody'
      const description = typeof draft.description === 'string' ? draft.description : ''
      if (description.length > MAX_DESCRIPTION) errors.description = 'errorDescription'
      const emoji = typeof draft.emoji === 'string' ? draft.emoji.trim() : ''
      if (emoji.length > MAX_EMOJI) errors.emoji = 'errorEmoji'
      const color = typeof draft.color === 'string' ? draft.color.trim() : ''
      if (!COLOR_PATTERN.test(color)) errors.color = 'errorColor'
      return errors
    }

    function buildPayload(draft) {
      return {
        name: draft.name,
        description: draft.description,
        emoji: draft.emoji.trim(),
        color: draft.color.trim(),
        body: draft.body,
      }
    }

    // ---------------------------------------------------------------------
    // Module definition.
    // ---------------------------------------------------------------------
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(function () {
          const disposeZh = ctx.locale.register(NS, 'zh', DICT.zh)
          const disposeEn = ctx.locale.register(NS, 'en', DICT.en)
          return function () {
            disposeEn()
            disposeZh()
          }
        })

        const t = ctx.locale.bind(NS)
        const localeSubscribe = function (listener) {
          return ctx.locale.subscribe(listener)
        }
        const localeGetSnapshot = function () {
          return ctx.locale.getSnapshot()
        }

        function useLocale() {
          React.useSyncExternalStore(localeSubscribe, localeGetSnapshot)
        }

        function usePersonaData(sessionId, enabled) {
          const [state, setState] = React.useState({
            status: 'loading',
            data: null,
            error: null,
          })
          const [reloadToken, setReloadToken] = React.useState(0)
          React.useEffect(
            function () {
              if (!enabled) return undefined
              let alive = true
              setState(function (previous) {
                return previous.data
                  ? { status: 'ready', data: previous.data, error: null }
                  : { status: 'loading', data: null, error: null }
              })
              let path = '/state'
              if (sessionId) path += '?sessionId=' + encodeURIComponent(String(sessionId))
              requestJson('GET', path).then(
                function (raw) {
                  if (!alive) return
                  setState({ status: 'ready', data: normalizeState(raw), error: null })
                },
                function (error) {
                  if (!alive) return
                  logWarn('could not load persona state', error)
                  setState(function (previous) {
                    return previous.data
                      ? { status: 'ready', data: previous.data, error: error }
                      : { status: 'error', data: null, error: error }
                  })
                },
              )
              return function () {
                alive = false
              }
            },
            [sessionId, enabled, reloadToken],
          )
          const reload = React.useCallback(function () {
            setReloadToken(function (token) {
              return token + 1
            })
          }, [])
          return [state, reload]
        }

        function renderFieldRow(labelText, hintText, errorText, control) {
          return h(
            'div',
            { className: 'dsh-pm-field' },
            h(
              'label',
              { className: 'dsh-pm-label', htmlFor: control.props.id },
              labelText,
            ),
            control,
            hintText ? h('div', { className: 'dsh-pm-hint' }, hintText) : null,
            errorText
              ? h('div', { className: 'dsh-pm-error', role: 'alert' }, errorText)
              : null,
          )
        }

        function PersonaEditor(props) {
          const persona = props && props.persona ? props.persona : null
          const [draft, setDraft] = React.useState(function () {
            return draftFromPersona(persona)
          })
          const [fieldErrors, setFieldErrors] = React.useState({})
          const [submitError, setSubmitError] = React.useState(null)
          const [saving, setSaving] = React.useState(false)
          const hasFieldErrors = Object.keys(fieldErrors).length > 0

          function update(field, value) {
            setDraft(function (previous) {
              const next = Object.assign({}, previous)
              next[field] = value
              return next
            })
            setFieldErrors(function (previous) {
              if (!previous[field]) return previous
              const next = Object.assign({}, previous)
              delete next[field]
              return next
            })
          }

          async function handleSubmit(event) {
            if (event && typeof event.preventDefault === 'function') event.preventDefault()
            if (saving) return
            const errors = validateDraft(draft)
            setFieldErrors(errors)
            if (Object.keys(errors).length > 0) return
            setSubmitError(null)
            setSaving(true)
            const payload = buildPayload(draft)
            try {
              let result
              if (persona) {
                result = await requestJson(
                  'PUT',
                  '/personas/' + encodeURIComponent(String(persona.id)),
                  payload,
                )
              } else {
                result = await requestJson('POST', '/personas', payload)
              }
              if (props && typeof props.onSaved === 'function') {
                props.onSaved(
                  persona ? 'edit' : 'create',
                  result && result.persona ? result.persona : null,
                )
              }
            } catch (error) {
              logWarn('could not save persona', error)
              setSubmitError(error)
            } finally {
              setSaving(false)
            }
          }

          function handleCancel() {
            if (saving) return
            if (props && typeof props.onCancel === 'function') props.onCancel()
          }

          const nameControl = h('input', {
            id: 'dsh-pm-name',
            className:
              'dsh-pm-input' + (fieldErrors.name ? ' dsh-pm-invalid' : ''),
            type: 'text',
            value: draft.name,
            maxLength: MAX_NAME,
            autoComplete: 'off',
            spellCheck: false,
            'aria-required': 'true',
            'aria-invalid': fieldErrors.name ? 'true' : 'false',
            onChange: function (event) {
              update('name', event.target.value)
            },
          })

          const emojiControl = h('input', {
            id: 'dsh-pm-emoji',
            className:
              'dsh-pm-input' + (fieldErrors.emoji ? ' dsh-pm-invalid' : ''),
            type: 'text',
            value: draft.emoji,
            maxLength: MAX_EMOJI,
            autoComplete: 'off',
            spellCheck: false,
            'aria-invalid': fieldErrors.emoji ? 'true' : 'false',
            onChange: function (event) {
              update('emoji', event.target.value)
            },
          })

          const colorControl = h(
            'div',
            { className: 'dsh-pm-colors' },
            COLOR_PRESETS.map(function (color, index) {
              return h('button', {
                key: color,
                type: 'button',
                className: 'dsh-pm-swatch',
                style: { background: color },
                'aria-pressed': draft.color === color ? 'true' : 'false',
                'aria-label': t('presetColor', { index: index + 1 }),
                title: color,
                onClick: function () {
                  update('color', color)
                },
              })
            }),
            h('input', {
              id: 'dsh-pm-color',
              className: 'dsh-pm-color-input',
              type: 'color',
              value: safeColor(draft.color),
              'aria-label': t('colorCustom'),
              title: t('colorCustom'),
              onChange: function (event) {
                update('color', event.target.value)
              },
            }),
            h('span', { className: 'dsh-pm-color-value' }, safeColor(draft.color)),
          )

          const descriptionControl = h('textarea', {
            id: 'dsh-pm-description',
            className:
              'dsh-pm-textarea' + (fieldErrors.description ? ' dsh-pm-invalid' : ''),
            rows: 2,
            value: draft.description,
            maxLength: MAX_DESCRIPTION,
            spellCheck: false,
            'aria-invalid': fieldErrors.description ? 'true' : 'false',
            onChange: function (event) {
              update('description', event.target.value)
            },
          })

          const bodyControl = h('textarea', {
            id: 'dsh-pm-body',
            className:
              'dsh-pm-textarea dsh-pm-textarea-code' +
              (fieldErrors.body ? ' dsh-pm-invalid' : ''),
            rows: 10,
            value: draft.body,
            maxLength: MAX_BODY,
            spellCheck: false,
            'aria-required': 'true',
            'aria-invalid': fieldErrors.body ? 'true' : 'false',
            onChange: function (event) {
              update('body', event.target.value)
            },
          })

          return h(
            'form',
            {
              className: 'dsh-pm-form',
              noValidate: true,
              onSubmit: handleSubmit,
              'aria-busy': saving ? 'true' : 'false',
            },
            h(
              'h3',
              { className: 'dsh-pm-form-title' },
              persona ? t('editTitle') : t('createTitle'),
            ),
            submitError
              ? h(
                  'div',
                  { className: 'dsh-pm-notice dsh-pm-notice-error', role: 'alert' },
                  describeError(t, submitError),
                )
              : hasFieldErrors
                ? h(
                    'div',
                    { className: 'dsh-pm-notice dsh-pm-notice-error', role: 'alert' },
                    t('editorInvalid'),
                  )
                : null,
            renderFieldRow(
              t('fieldName'),
              t('hintName') + ' · ' + draft.name.length + '/' + MAX_NAME,
              fieldErrors.name ? t(fieldErrors.name) : null,
              nameControl,
            ),
            renderFieldRow(
              t('fieldEmoji'),
              t('hintEmoji'),
              fieldErrors.emoji ? t(fieldErrors.emoji) : null,
              emojiControl,
            ),
            renderFieldRow(
              t('fieldColor'),
              null,
              fieldErrors.color ? t(fieldErrors.color) : null,
              colorControl,
            ),
            renderFieldRow(
              t('fieldDescription'),
              t('hintDescription') +
                ' · ' +
                draft.description.length +
                '/' +
                MAX_DESCRIPTION,
              fieldErrors.description ? t(fieldErrors.description) : null,
              descriptionControl,
            ),
            renderFieldRow(
              t('fieldBody'),
              t('hintBody') + ' · ' + draft.body.length + '/' + MAX_BODY,
              fieldErrors.body ? t(fieldErrors.body) : null,
              bodyControl,
            ),
            h(
              'div',
              { className: 'dsh-pm-form-actions' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-pm-btn',
                  disabled: saving,
                  onClick: handleCancel,
                },
                t('cancel'),
              ),
              h(
                'button',
                {
                  type: 'submit',
                  className: 'dsh-pm-btn dsh-pm-btn-primary',
                  disabled: saving,
                },
                saving ? t('saving') : t('save'),
              ),
            ),
          )
        }

        function PersonaSettingsSection(props) {
          useLocale()
          const [state, reload] = usePersonaData(null, true)
          const [editor, setEditor] = React.useState(null)
          const [notice, setNotice] = React.useState(null)
          const [pendingDeleteId, setPendingDeleteId] = React.useState(null)
          const [busy, setBusy] = React.useState(false)

          const data = state.data
          const personas = data ? data.personas : []
          const globalId = data && data.global ? data.global.activePersonaId : null
          const loading = state.status === 'loading'
          const loadFailed = state.status === 'error' && !data
          const refreshError = state.error && data ? state.error : null

          async function handleSetGlobal(persona) {
            if (busy || !persona) return
            setBusy(true)
            setNotice(null)
            try {
              await requestJson('POST', '/switch', {
                scope: 'global',
                personaId: persona.id,
              })
              setNotice({ kind: 'success', text: t('globalSet') })
              reload()
            } catch (error) {
              logWarn('could not set global persona', error)
              setNotice({ kind: 'error', text: describeError(t, error) })
            } finally {
              setBusy(false)
            }
          }

          async function handleDelete(persona) {
            if (busy || !persona) return
            setBusy(true)
            setNotice(null)
            try {
              const result = await requestJson(
                'DELETE',
                '/personas/' + encodeURIComponent(String(persona.id)),
              )
              setPendingDeleteId(null)
              setNotice({
                kind: 'success',
                text:
                  result && result.clearedGlobal ? t('deletedClearedGlobal') : t('deleted'),
              })
              reload()
            } catch (error) {
              logWarn('could not delete persona', error)
              setNotice({ kind: 'error', text: describeError(t, error) })
            } finally {
              setBusy(false)
            }
          }

          function handleSaved(mode) {
            setEditor(null)
            setNotice({ kind: 'success', text: mode === 'create' ? t('created') : t('saved') })
            reload()
          }

          function handleCancelEditor() {
            setEditor(null)
          }

          function renderPersonaRow(persona) {
            const isGlobal = globalId === persona.id
            const confirming = pendingDeleteId === persona.id
            const actions = []
            if (!isGlobal) {
              actions.push(
                h(
                  'button',
                  {
                    key: 'global',
                    type: 'button',
                    className: 'dsh-pm-btn',
                    disabled: busy,
                    onClick: function () {
                      handleSetGlobal(persona)
                    },
                  },
                  t('setGlobal'),
                ),
              )
            }
            actions.push(
              h(
                'button',
                {
                  key: 'edit',
                  type: 'button',
                  className: 'dsh-pm-btn',
                  disabled: busy,
                  onClick: function () {
                    setPendingDeleteId(null)
                    setEditor({ persona: persona })
                  },
                },
                t('edit'),
              ),
            )
            if (confirming) {
              actions.push(
                h(
                  'span',
                  { key: 'confirm-text', className: 'dsh-pm-confirm-text' },
                  t('confirmDelete', { name: persona.name }),
                ),
              )
              actions.push(
                h(
                  'button',
                  {
                    key: 'confirm',
                    type: 'button',
                    className: 'dsh-pm-btn dsh-pm-btn-danger',
                    disabled: busy,
                    onClick: function () {
                      handleDelete(persona)
                    },
                  },
                  t('confirm'),
                ),
              )
              actions.push(
                h(
                  'button',
                  {
                    key: 'cancel-delete',
                    type: 'button',
                    className: 'dsh-pm-btn',
                    disabled: busy,
                    onClick: function () {
                      setPendingDeleteId(null)
                    },
                  },
                  t('cancel'),
                ),
              )
            } else {
              actions.push(
                h(
                  'button',
                  {
                    key: 'delete',
                    type: 'button',
                    className: 'dsh-pm-btn dsh-pm-btn-danger',
                    disabled: busy,
                    onClick: function () {
                      setPendingDeleteId(persona.id)
                    },
                  },
                  t('delete'),
                ),
              )
            }
            return h(
              'li',
              { key: persona.id, className: 'dsh-pm-row' },
              h(
                'span',
                {
                  className: 'dsh-pm-avatar',
                  style: { background: safeColor(persona.color) },
                  'aria-hidden': 'true',
                },
                personaEmoji(persona),
              ),
              h(
                'div',
                { className: 'dsh-pm-row-main' },
                h(
                  'div',
                  { className: 'dsh-pm-name' },
                  h('span', null, persona.name),
                  isGlobal
                    ? h('span', { className: 'dsh-pm-badge' }, t('globalBadge'))
                    : null,
                ),
                h(
                  'div',
                  { className: 'dsh-pm-desc-text' },
                  persona.description ? persona.description : t('noDescription'),
                ),
              ),
              h('div', { className: 'dsh-pm-actions' }, actions),
            )
          }

          const header = h(
            'div',
            { className: 'dsh-pm-head' },
            h(
              'div',
              { className: 'dsh-pm-head-main' },
              h('h2', { className: 'dsh-pm-title' }, t('settingsTitle')),
              h('p', { className: 'dsh-pm-desc' }, t('settingsDesc')),
              data
                ? h(
                    'p',
                    { className: 'dsh-pm-muted' },
                    t('personaCount', { count: personas.length }),
                  )
                : null,
            ),
            h(
              'div',
              { className: 'dsh-pm-head-actions' },
              editor
                ? null
                : h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-pm-btn dsh-pm-btn-primary',
                      disabled: loading || loadFailed,
                      onClick: function () {
                        setPendingDeleteId(null)
                        setEditor({ persona: null })
                      },
                    },
                    t('addPersona'),
                  ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-pm-btn',
                  disabled: loading || busy,
                  onClick: reload,
                },
                t('refresh'),
              ),
            ),
          )

          const notices = []
          if (notice) {
            notices.push(
              h(
                'div',
                {
                  key: 'notice',
                  className:
                    'dsh-pm-notice ' +
                    (notice.kind === 'error'
                      ? 'dsh-pm-notice-error'
                      : 'dsh-pm-notice-success'),
                  role: notice.kind === 'error' ? 'alert' : 'status',
                },
                notice.text,
              ),
            )
          }
          if (refreshError) {
            notices.push(
              h(
                'div',
                {
                  key: 'refresh-error',
                  className: 'dsh-pm-notice dsh-pm-notice-error',
                  role: 'alert',
                },
                t('errorLoad') + ' ' + describeError(t, refreshError),
              ),
            )
          }

          let body
          if (editor) {
            body = h(PersonaEditor, {
              key: editor.persona ? 'edit-' + editor.persona.id : 'create',
              persona: editor.persona,
              onCancel: handleCancelEditor,
              onSaved: handleSaved,
            })
          } else if (loading) {
            body = h(
              'div',
              { className: 'dsh-pm-loading', role: 'status' },
              t('loading'),
            )
          } else if (loadFailed) {
            body = h(
              'div',
              { className: 'dsh-pm-empty' },
              h(
                'div',
                { className: 'dsh-pm-notice dsh-pm-notice-error', role: 'alert' },
                t('errorLoad') + ' ' + describeError(t, state.error),
              ),
              h(
                'button',
                { type: 'button', className: 'dsh-pm-btn', onClick: reload },
                t('retry'),
              ),
            )
          } else if (personas.length === 0) {
            body = h(
              'div',
              { className: 'dsh-pm-empty' },
              h('p', { className: 'dsh-pm-muted' }, t('emptyList')),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-pm-btn dsh-pm-btn-primary',
                  onClick: function () {
                    setPendingDeleteId(null)
                    setEditor({ persona: null })
                  },
                },
                t('addPersona'),
              ),
            )
          } else {
            body = h('ul', { className: 'dsh-pm-list' }, personas.map(renderPersonaRow))
          }

          return h(
            'div',
            {
              className: 'dsh-pm-settings',
              'aria-busy': busy ? 'true' : 'false',
              'data-dsh-pm': 'settings',
            },
            h('style', { key: 'dsh-pm-settings-style' }, SETTINGS_CSS),
            header,
            notices,
            body,
          )
        }

        function PersonaChip(props) {
          useLocale()
          const rawSessionId = props && props.sessionId ? props.sessionId : ''
          const sessionId = rawSessionId ? String(rawSessionId) : ''
          const hasSession = Boolean(sessionId)
          const [state, reload] = usePersonaData(hasSession ? sessionId : null, hasSession)
          const [open, setOpen] = React.useState(false)
          const [position, setPosition] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [actionError, setActionError] = React.useState(null)
          const [notice, setNotice] = React.useState(null)
          const buttonRef = React.useRef(null)
          const popoverRef = React.useRef(null)

          const data = state.data
          const personas = data ? data.personas : []
          const effectiveId = data ? data.effectivePersonaId : null
          const effectivePersona = findPersona(personas, effectiveId)
          const globalId = data && data.global ? data.global.activePersonaId : null
          const globalPersona = findPersona(personas, globalId)
          const sessionRecord = data ? data.session : null
          const hasOverride =
            Boolean(data) && sessionRecord !== null && sessionRecord !== undefined
          const overrideId =
            hasOverride && sessionRecord && typeof sessionRecord.personaId === 'string'
              ? sessionRecord.personaId
              : null
          const dataFailed = state.status === 'error' && !data

          const closePopover = React.useCallback(function () {
            setOpen(false)
            setActionError(null)
            setNotice(null)
          }, [])

          const updatePosition = React.useCallback(function () {
            const button = buttonRef.current
            if (!button || typeof button.getBoundingClientRect !== 'function') return
            const rect = button.getBoundingClientRect()
            const win = typeof window !== 'undefined' ? window : null
            const viewportWidth = win && win.innerWidth ? win.innerWidth : 360
            const viewportHeight = win && win.innerHeight ? win.innerHeight : 640
            const width = Math.min(340, Math.max(220, viewportWidth - 16))
            const maxLeft = Math.max(8, viewportWidth - width - 8)
            const left = Math.min(Math.max(8, rect.left), maxLeft)
            const spaceAbove = Math.max(0, rect.top - 10)
            const spaceBelow = Math.max(0, viewportHeight - rect.bottom - 10)
            if (spaceAbove >= 180 || spaceAbove >= spaceBelow) {
              setPosition({
                left: left,
                bottom: Math.max(8, Math.round(viewportHeight - rect.top + 6)),
                maxHeight: Math.max(120, Math.round(spaceAbove - 6)),
                width: width,
              })
            } else {
              setPosition({
                left: left,
                top: Math.round(rect.bottom + 6),
                maxHeight: Math.max(120, Math.round(spaceBelow - 6)),
                width: width,
              })
            }
          }, [])

          React.useEffect(
            function () {
              if (!open) {
                setPosition(null)
                return undefined
              }
              updatePosition()
              const win = typeof window !== 'undefined' ? window : null
              const doc = typeof document !== 'undefined' ? document : null
              function handleKeyDown(event) {
                if (!event || event.key !== 'Escape') return
                if (typeof event.stopPropagation === 'function') event.stopPropagation()
                setOpen(false)
                setActionError(null)
                setNotice(null)
                const button = buttonRef.current
                if (button && typeof button.focus === 'function') button.focus()
              }
              function handlePointerDown(event) {
                const targetNode = event ? event.target : null
                const popover = popoverRef.current
                const button = buttonRef.current
                if (
                  popover &&
                  targetNode &&
                  typeof popover.contains === 'function' &&
                  popover.contains(targetNode)
                ) {
                  return
                }
                if (
                  button &&
                  targetNode &&
                  typeof button.contains === 'function' &&
                  button.contains(targetNode)
                ) {
                  return
                }
                setOpen(false)
                setActionError(null)
                setNotice(null)
              }
              if (doc) {
                doc.addEventListener('keydown', handleKeyDown, true)
                doc.addEventListener('mousedown', handlePointerDown, true)
              }
              if (win) {
                win.addEventListener('resize', updatePosition)
                win.addEventListener('scroll', updatePosition, true)
              }
              return function cleanup() {
                if (doc) {
                  doc.removeEventListener('keydown', handleKeyDown, true)
                  doc.removeEventListener('mousedown', handlePointerDown, true)
                }
                if (win) {
                  win.removeEventListener('resize', updatePosition)
                  win.removeEventListener('scroll', updatePosition, true)
                }
              }
            },
            [open, updatePosition],
          )

          function handleToggle() {
            if (open) {
              closePopover()
              return
            }
            setActionError(null)
            setNotice(null)
            updatePosition()
            setOpen(true)
            if (hasSession) reload()
          }

          async function runSwitch(scope, personaId, keepOpen) {
            if (busy || !hasSession) return
            setBusy(true)
            setActionError(null)
            setNotice(null)
            try {
              const payload = { scope: scope, personaId: personaId }
              if (scope === 'session') payload.sessionId = sessionId
              await requestJson('POST', '/switch', payload)
              reload()
              if (keepOpen) {
                setNotice({ kind: 'success', text: t('globalSet') })
              } else {
                closePopover()
              }
            } catch (error) {
              logWarn('could not switch persona', error)
              setActionError(describeError(t, error))
            } finally {
              setBusy(false)
            }
          }

          function renderOption(selected, onClick, dot, dotColor, text, key) {
            return h(
              'li',
              { key: key, className: 'dsh-pm-option-item' },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-pm-option',
                  role: 'option',
                  'aria-selected': selected ? 'true' : 'false',
                  disabled: busy,
                  onClick: onClick,
                },
                h(
                  'span',
                  {
                    className: 'dsh-pm-option-dot',
                    style: dotColor ? { background: dotColor } : undefined,
                    'aria-hidden': 'true',
                  },
                  dot,
                ),
                h('span', { className: 'dsh-pm-option-main' }, text),
                selected
                  ? h('span', { className: 'dsh-pm-option-check', 'aria-hidden': 'true' }, '✓')
                  : null,
              ),
            )
          }

          function renderPopover() {
            if (!open) return null
            const style = position
              ? {
                  left: position.left + 'px',
                  width: position.width + 'px',
                  maxHeight: position.maxHeight + 'px',
                  ...(position.top !== undefined
                    ? { top: position.top + 'px' }
                    : { bottom: position.bottom + 'px' }),
                }
              : { left: '8px', bottom: '8px', width: '300px', maxHeight: '320px' }
            const content = []
            content.push(
              h(
                'div',
                { key: 'head', className: 'dsh-pm-popover-head' },
                h('span', { className: 'dsh-pm-popover-title' }, t('chipTitle')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-pm-icon-btn',
                    onClick: closePopover,
                    'aria-label': t('close'),
                    title: t('close'),
                  },
                  '×',
                ),
              ),
            )
            if (notice) {
              content.push(
                h(
                  'div',
                  {
                    key: 'notice',
                    className: 'dsh-pm-notice dsh-pm-notice-success',
                    role: 'status',
                  },
                  notice.text,
                ),
              )
            }
            if (actionError) {
              content.push(
                h(
                  'div',
                  {
                    key: 'action-error',
                    className: 'dsh-pm-notice dsh-pm-notice-error',
                    role: 'alert',
                  },
                  actionError,
                ),
              )
            }
            if (state.status === 'loading' && !data) {
              content.push(
                h('div', { key: 'loading', className: 'dsh-pm-muted' }, t('loading')),
              )
            } else if (dataFailed) {
              content.push(
                h(
                  'div',
                  {
                    key: 'load-error',
                    className: 'dsh-pm-notice dsh-pm-notice-error',
                    role: 'alert',
                  },
                  t('errorLoad') + ' ' + describeError(t, state.error),
                ),
              )
              content.push(
                h(
                  'button',
                  { key: 'retry', type: 'button', className: 'dsh-pm-btn', onClick: reload },
                  t('retry'),
                ),
              )
            } else {
              const globalName = globalPersona ? globalPersona.name : t('noPersona')
              const options = []
              options.push(
                renderOption(
                  !hasOverride,
                  function () {
                    runSwitch('session', null, false)
                  },
                  '🌐',
                  null,
                  t('followGlobalCurrent', { name: globalName }),
                  'follow-global',
                ),
              )
              personas.forEach(function (persona) {
                options.push(
                  renderOption(
                    hasOverride && overrideId === persona.id,
                    function () {
                      runSwitch('session', persona.id, false)
                    },
                    personaEmoji(persona),
                    safeColor(persona.color),
                    persona.name,
                    persona.id,
                  ),
                )
              })
              content.push(
                h(
                  'ul',
                  {
                    key: 'options',
                    className: 'dsh-pm-options',
                    role: 'listbox',
                    'aria-label': t('chipTitle'),
                  },
                  options,
                ),
              )
              if (hasOverride && overrideId === null) {
                content.push(
                  h(
                    'div',
                    { key: 'explicit-none', className: 'dsh-pm-muted' },
                    t('sessionExplicitNone'),
                  ),
                )
              }
              content.push(
                h('hr', { key: 'divider', className: 'dsh-pm-divider' }),
                h(
                  'button',
                  {
                    key: 'set-global',
                    type: 'button',
                    className: 'dsh-pm-btn dsh-pm-btn-primary dsh-pm-popover-global',
                    disabled: busy || !effectiveId || effectiveId === globalId,
                    title:
                      effectiveId && effectiveId === globalId
                        ? t('alreadyGlobal')
                        : t('setCurrentAsGlobal'),
                    onClick: function () {
                      runSwitch('global', effectiveId, true)
                    },
                  },
                  t('setCurrentAsGlobal'),
                ),
              )
            }
            return h(
              'div',
              {
                key: 'popover',
                ref: popoverRef,
                className: 'dsh-pm-popover',
                style: style,
                role: 'dialog',
                'aria-label': t('chipTitle'),
                'data-dsh-pm': 'popover',
              },
              content,
            )
          }

          const chipLabel = effectivePersona ? effectivePersona.name : t('chipFallback')
          const chipEmoji = effectivePersona ? personaEmoji(effectivePersona) : DEFAULT_EMOJI
          const chipTitle = hasSession ? t('chipAria') : t('noSession')

          return h(
            'span',
            { className: 'dsh-pm-chip-wrap', 'data-dsh-pm': 'chip' },
            h('style', { key: 'dsh-pm-chip-style' }, CHIP_CSS),
            h(
              'button',
              {
                ref: buttonRef,
                type: 'button',
                className: 'dsh-pm-chip',
                onClick: handleToggle,
                disabled: !hasSession,
                title: chipTitle,
                'aria-haspopup': 'listbox',
                'aria-expanded': open ? 'true' : 'false',
              },
              h('span', { className: 'dsh-pm-chip-emoji', 'aria-hidden': 'true' }, chipEmoji),
              h('span', { className: 'dsh-pm-chip-name' }, chipLabel),
              h('span', { className: 'dsh-pm-chip-caret', 'aria-hidden': 'true' }, '▾'),
            ),
            renderPopover(),
          )
        }

        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register(
            {
              name: 'settings.section',
              id: 'persona-manager',
              order: 30,
              label: function () {
                return t('navLabel')
              },
            },
            PersonaSettingsSection,
          )
        })

        ctx.slots.inject('conversation.input.left', function () {
          return ctx.slots.register(
            {
              name: 'conversation.input.left',
              id: 'persona-manager',
              order: 10,
            },
            PersonaChip,
          )
        })
      },
    }
  },
})
