// sortModels is the order the panel lists models in: newest version first,
// stable whatever Magpie's picks order is, so a row doesn't move on Apply.
export function sortModels(slugs) {
  return [...new Set(slugs)].sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
}

// listModels is every Codex model of the account with whether Magpie hides it.
export function listModels(state) {
  checkState(state)
  return sortModels([...state.exposed, ...state.hidden]).map((slug) => ({ slug, hidden: state.hidden.includes(slug) }))
}

function checkState(state) {
  if (!state || !Array.isArray(state.exposed) || !Array.isArray(state.hidden)) throw new Error("读不懂 Magpie 返回的 Codex 模型状态")
}

// stateRefusal is why the panel can't show or change the models, or "".
export function stateRefusal(state) {
  checkState(state)
  if (state.disabled) return "Magpie 里的 Codex 供应商已关闭：先在 Magpie 打开它，再选择模型"
  if (state.truncated) return "Codex 模型列表太长被 Magpie 截断，这里读不全；请在 Magpie 的 Codex 供应商里修改"
  return ""
}

// buildPlan turns the models the panel wants hidden into Magpie CLI edits
// (`magpie provider models codex …`): `none` when every model is hidden,
// `all` (Magpie's default) when none is, else the whole list of models to
// show. `all` may leave some hidden when Magpie's default is a shorter
// list, so the explicit list is its fallback.
export function buildPlan(state, hidden) {
  const refusal = stateRefusal(state)
  if (refusal) throw new Error(refusal)
  const available = sortModels([...state.exposed, ...state.hidden])
  if (!available.length) throw new Error("Codex 账号没有列出任何模型")
  const unknown = hidden.filter((slug) => !available.includes(slug))
  if (unknown.length) throw new Error(`Codex 账号没有这些模型：${unknown.join(", ")}；刷新后再选`)
  const wanted = new Set(hidden)
  const plan = {
    hidden: available.filter((slug) => wanted.has(slug)),
    shown: available.filter((slug) => !wanted.has(slug)),
    commands: [],
    fallback: null,
  }
  plan.toHide = plan.hidden.filter((slug) => !state.hidden.includes(slug))
  plan.toShow = plan.shown.filter((slug) => !state.exposed.includes(slug))
  if (!plan.toHide.length && !plan.toShow.length) return plan
  if (!plan.shown.length) plan.commands.push(["none"])
  else if (!plan.hidden.length) {
    plan.commands.push(["all"])
    plan.fallback = [...plan.shown]
  } else plan.commands.push([...plan.shown])
  return plan
}

// verifyState is the models Magpie doesn't have as the plan wants: a hidden
// one still exposed, or a shown one still hidden.
export function verifyState(state, plan) {
  checkState(state)
  return [
    ...plan.hidden.filter((slug) => !state.hidden.includes(slug)),
    ...plan.shown.filter((slug) => !state.exposed.includes(slug)),
  ]
}
