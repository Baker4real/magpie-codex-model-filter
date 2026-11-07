import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { catalogMismatches, codexCatalogPath, readCatalog } from "../lib/catalog.mjs"

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures")
const plan = { hidden: ["gpt-6-luna"], shown: ["gpt-5.6-luna"] }

test("the catalog is magpie-desktop-models.json in CODEX_HOME, else ~/.codex", () => {
  assert.equal(codexCatalogPath({ CODEX_HOME: " D:/Codex/.codex " }), path.join("D:/Codex/.codex", "magpie-desktop-models.json"))
  assert.equal(codexCatalogPath({}), path.join(os.homedir(), ".codex", "magpie-desktop-models.json"))
})

test("a missing catalog reads as null, a present one as slugs and visibility", async () => {
  assert.equal(await readCatalog(path.join(fixtures, "missing.json")), null)
  assert.deepEqual(await readCatalog(path.join(fixtures, "magpie-desktop-models.json")), [
    { slug: "gpt-6-luna", visibility: "hide" },
    { slug: "gpt-5.6-luna", visibility: "list" },
  ])
})

test("hidden models must be absent or hide, shown ones listed once", () => {
  assert.deepEqual(catalogMismatches([{ slug: "gpt-5.6-luna", visibility: "list" }], plan), { stillListed: [], notListed: [] })
  assert.deepEqual(catalogMismatches([{ slug: "gpt-6-luna", visibility: "hide" }, { slug: "gpt-5.6-luna", visibility: "list" }], plan), { stillListed: [], notListed: [] })
  assert.deepEqual(catalogMismatches([{ slug: "gpt-6-luna", visibility: "list" }, { slug: "gpt-5.6-luna", visibility: "hide" }], plan), { stillListed: ["gpt-6-luna"], notListed: ["gpt-5.6-luna"] })
})

test("a model listed twice counts as not synced", () => {
  const twice = [
    { slug: "gpt-6-luna", visibility: "hide" },
    { slug: "gpt-6-luna", visibility: "hide" },
    { slug: "gpt-5.6-luna", visibility: "list" },
    { slug: "gpt-5.6-luna", visibility: "list" },
  ]
  assert.deepEqual(catalogMismatches(twice, plan), { stillListed: ["gpt-6-luna"], notListed: ["gpt-5.6-luna"] })
  assert.throws(() => catalogMismatches({}, plan), /invalid/)
})
