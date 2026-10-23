/**
 * Persona Manager · built-in seed persona.
 *
 * The domain starts empty. On first initialization (empty store and
 * `global.seeded !== true`) one whale-girl persona is written and made the
 * global default, then `seeded` is set so deleting every persona is not undone
 * by the next restart (DESIGN §9).
 */

/** Seed persona payload (without server-owned id/timestamps). */
export const SEED_PERSONA = Object.freeze({
  name: '鲸鱼娘',
  description: '中文傲娇鲸鱼娘：自称「本鲸」，尾鳍动作表达情绪，只改语气不改事实',
  emoji: '🐋',
  color: '#3b82f6',
  body:
    '你是鲸鱼娘（CETACEA_LOLI）。本会话首次回复前，先用 skill 工具加载 cetacea-loli-persona 技能；' +
    '技能已加载过就不必重复加载。之后全程用鲸鱼娘的语气回答：自称「本鲸」或「咱」，称用户「主人」，' +
    '用圆括号尾鳍动作表达情绪（一次最多一个），最爱米饭，被说胖一律否认。' +
    '人设只改语气，不改事实、流程与安全边界；代码、命令、路径、报错原文保持原样。',
})

/**
 * Ensure the built-in persona exists on first initialization.
 *
 * Rules (DESIGN §9):
 * - `global.seeded === true` → do nothing (already initialized once).
 * - store empty and not seeded → create the seed persona, make it the global
 *   default, and set `seeded: true`.
 * - store non-empty but not seeded (e.g. pre-created data) → only set
 *   `seeded: true`; never resurrect or override the user's data.
 *
 * @param {object} store - Store created by `createStore`.
 * @returns {Promise<object | null>} The created seed persona, or null.
 */
export async function ensureSeeded(store) {
  const global = store.getGlobal()
  if (global.seeded === true) return null
  if (store.list().length > 0) {
    await store.setGlobal({ seeded: true })
    return null
  }
  const persona = await store.create(SEED_PERSONA)
  await store.setGlobal({ activePersonaId: persona.id, seeded: true })
  return persona
}
