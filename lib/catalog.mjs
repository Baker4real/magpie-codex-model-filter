import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// codexCatalogPath is the model list Magpie writes for the Codex app beside
// its sign-in: magpie-desktop-models.json in CODEX_HOME (else ~/.codex).
export function codexCatalogPath(env = process.env) {
  const home = typeof env.CODEX_HOME === "string" && env.CODEX_HOME.trim() ? env.CODEX_HOME.trim() : path.join(os.homedir(), ".codex")
  return path.join(home, "magpie-desktop-models.json")
}

// readCatalog is that list's slugs and visibility, or null when Magpie
// hasn't written it (Codex not wired to Magpie): nothing to check against.
export async function readCatalog(file = codexCatalogPath()) {
  let body
  try {
    body = await fs.readFile(file, "utf8")
  } catch (error) {
    if (error?.code === "ENOENT") return null
    throw error
  }
  const data = JSON.parse(body)
  if (!Array.isArray(data?.models)) throw new Error("Codex model catalog has no models array")
  return data.models.map((model) => ({ slug: model?.slug, visibility: model?.visibility }))
}

// catalogMismatches is what the Codex list doesn't show as the plan wants
// yet: a hidden model still listed (or listed twice), a shown one missing,
// hidden or listed twice.
export function catalogMismatches(catalog, { hidden, shown }) {
  if (!Array.isArray(catalog)) throw new Error("Codex model catalog is invalid")
  const records = (slug) => catalog.filter((entry) => entry?.slug === slug)
  return {
    stillListed: hidden.filter((slug) => {
      const found = records(slug)
      return found.length > 1 || found.length === 1 && found[0].visibility !== "hide"
    }),
    notListed: shown.filter((slug) => {
      const found = records(slug)
      return found.length !== 1 || found[0].visibility === "hide"
    }),
  }
}
