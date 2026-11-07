// Bun smoke: the service under Bun.serve as Magpie's plugin host runs it,
// with a runner that may only read.
import assert from "node:assert/strict"
import { createHandler } from "../lib/service.mjs"

const runner = {
  async state() {
    return { exposed: ["gpt-5.6-luna"], hidden: ["gpt-6-luna", "gpt-5.6-terra"], disabled: false, truncated: false }
  },
  async edit() {
    throw new Error("smoke must never write")
  },
}
const token = "smoke-token"
let handler
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => handler(request) })
handler = createHandler({ runner, port: server.port, token, readCatalog: async () => null })
try {
  const base = `http://127.0.0.1:${server.port}`
  const page = await fetch(base + "/")
  assert.equal(page.status, 200)
  const html = await page.text()
  assert.match(html, /<meta name="codex-model-filter-token" content="smoke-token">/)
  assert.ok(html.includes(`connect-src http://127.0.0.1:${server.port} `))

  const preflight = await fetch(base + "/api/state", {
    method: "OPTIONS",
    headers: { origin: "null", "access-control-request-method": "GET", "access-control-request-headers": "x-codex-model-filter-token" },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get("access-control-allow-origin"), "null")

  const refused = await fetch(base + "/api/state", { headers: { origin: "null" } })
  assert.equal(refused.status, 403)

  const listed = await fetch(base + "/api/state", { headers: { origin: "null", "x-codex-model-filter-token": token } })
  assert.equal(listed.status, 200)
  assert.equal(listed.headers.get("access-control-allow-origin"), "null")
  const body = await listed.json()
  assert.deepEqual(body.models.map((model) => model.slug), ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"])
  console.log("smoke ok on " + base)
} finally {
  server.stop(true)
}
