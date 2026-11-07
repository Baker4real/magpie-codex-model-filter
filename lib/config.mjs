const SLUG = /^[a-z0-9][a-z0-9._-]*$/i
const MAX_MODELS = 200

// normalizeHidden is the list of Codex model slugs the panel wants hidden:
// bare slugs, trimmed, each once; an empty list hides nothing.
export function normalizeHidden(value) {
  if (!Array.isArray(value)) throw new Error("hidden 必须是模型 slug 列表")
  if (value.length > MAX_MODELS) throw new Error("模型太多")
  const out = []
  for (const raw of value) {
    if (typeof raw !== "string") throw new Error("每一项都必须是模型 slug")
    const slug = raw.trim()
    if (!SLUG.test(slug)) throw new Error(`不是有效的模型 slug：${JSON.stringify(raw)}`)
    if (!out.some((seen) => seen.toLowerCase() === slug.toLowerCase())) out.push(slug)
  }
  return out
}

export function normalizeMagpiePath(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return { kind: "path", value: "magpie" }
  }
  if (typeof value !== "string") throw new Error("magpiePath must be a string")
  const trimmed = value.trim()
  if (/[\r\n\0]/.test(trimmed)) throw new Error("magpiePath must be one executable path")
  if (/^[a-zA-Z]:[\\/].*\.exe$/i.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\\\")) {
    return { kind: "absolute", value: trimmed }
  }
  if (trimmed === "magpie") return { kind: "path", value: "magpie" }
  throw new Error("magpiePath must be 'magpie' or an absolute executable path")
}

// resolveOptions reads the plugin's options from plugins.json. Which models
// are hidden is Magpie's own Codex provider setting, chosen in the settings
// panel; a hiddenModels key left by 0.1.x is ignored.
export function resolveOptions(options = {}) {
  const port = Number(options.port ?? 3477)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("port must be between 1024 and 65535")
  return { port, magpiePath: normalizeMagpiePath(options.magpiePath) }
}
