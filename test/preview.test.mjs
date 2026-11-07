import assert from "node:assert/strict"
import test from "node:test"
import { THEMES, startPreview } from "../lib/preview.mjs"

const flags = (models) => models.map(({ slug, hidden }) => `${slug}:${hidden ? "hidden" : "shown"}`)

test("the preview serves the real panel page, answering its theme call, and the API against a stand-in Magpie", async () => {
  const preview = await startPreview()
  try {
    const page = await (await fetch(`${preview.url}?theme=dark`)).text()
    const token = page.match(/<meta name="codex-model-filter-token" content="([0-9a-f]+)">/)[1]
    assert.ok(page.includes(`connect-src ${preview.url.slice(0, -1)} `))
    assert.ok(page.includes(`result: ${JSON.stringify(THEMES.dark)}`))
    assert.match(page, /<\/script>\n<\/html>$/)

    const headers = { "x-codex-model-filter-token": token }
    const state = await (await fetch(`${preview.url}api/state`, { headers })).json()
    assert.deepEqual(flags(state.models), ["gpt-6-luna:hidden", "gpt-5.6-terra:hidden", "gpt-5.6-luna:hidden"])

    const applied = await (await fetch(`${preview.url}api/apply`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ hidden: ["gpt-6-luna"] }),
    })).json()
    assert.equal(applied.ok, true)
    assert.deepEqual(flags(applied.models), ["gpt-6-luna:hidden", "gpt-5.6-terra:shown", "gpt-5.6-luna:shown"])
    assert.equal(applied.catalog.status, "verified")
  } finally {
    await preview.close()
  }
})
