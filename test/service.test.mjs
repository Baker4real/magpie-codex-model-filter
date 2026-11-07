import assert from "node:assert/strict"
import test from "node:test"
import { createHandler, startService } from "../lib/service.mjs"

const three = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"]
const HOST = "127.0.0.1:3477"
const TOKEN = "test-token"
const CATALOG = "D:/codex-home/magpie-desktop-models.json"

// fakeMagpie stands in for `magpie provider models codex …`: plain ids pick
// exactly those, `none` serves none, `all` goes back to the default picks.
function fakeMagpie({ models = three, exposed = [], defaults = models, disabled = false } = {}) {
  const calls = []
  let shown = [...exposed]
  return {
    calls,
    async state() {
      calls.push(["state"])
      if (disabled) return { exposed: [], hidden: [], disabled: true, truncated: false }
      return { exposed: [...shown], hidden: models.filter((slug) => !shown.includes(slug)), disabled: false, truncated: false }
    },
    async edit(edits) {
      calls.push(["edit", ...edits])
      if (edits[0] === "none") shown = []
      else if (edits[0] === "all") shown = [...defaults]
      else shown = [...edits]
    },
  }
}

function serviceFor(runner, extra = {}) {
  return createHandler({ runner, port: 3477, token: TOKEN, catalogFile: CATALOG, readCatalog: async () => null, ...extra })
}

// a request as the settings panel's sandboxed frame sends it
function call(handler, path, { method = "GET", body, token = TOKEN, headers = {} } = {}) {
  const init = { method, headers: { host: HOST, origin: "null", ...(token ? { "x-codex-model-filter-token": token } : {}), ...headers } }
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body)
    init.headers["content-type"] = "application/json"
  }
  return handler(new Request(`http://${HOST}/${path}`, init))
}

const apply = (handler, hidden) => call(handler, "api/apply", { method: "POST", body: { hidden } })
const flags = (models) => models.map(({ slug, hidden }) => `${slug}:${hidden ? "hidden" : "shown"}`)

test("the page carries its token and may only reach this service", async () => {
  const response = await call(serviceFor(fakeMagpie()), "", { token: "" })
  assert.equal(response.status, 200)
  assert.match(response.headers.get("content-type"), /^text\/html/)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const html = await response.text()
  assert.match(html, /<meta name="codex-model-filter-token" content="test-token">/)
  assert.match(html, /default-src 'none'; [^"]*connect-src http:\/\/127\.0\.0\.1:3477 http:\/\/localhost:3477;/)
})

test("only 127.0.0.1 and localhost on the service port are answered", async () => {
  const handler = serviceFor(fakeMagpie())
  for (const host of ["evil.example", "127.0.0.1:80", "localhost"]) {
    assert.equal((await call(handler, "", { headers: { host } })).status, 403)
    assert.equal((await call(handler, "api/state", { headers: { host } })).status, 403)
  }
  assert.equal((await call(handler, "", { headers: { host: "localhost:3477" } })).status, 200)
})

test("health names the Magpie executable, and new options swap it", async () => {
  const handler = serviceFor(fakeMagpie(), { magpie: "D:/Apps/magpie/magpie.exe" })
  assert.deepEqual(await (await call(handler, "api/health", { token: "" })).json(), { ok: true, magpie: "D:/Apps/magpie/magpie.exe", scope: "codex-provider-picks" })
  handler.update({ magpiePath: { kind: "absolute", value: "E:/magpie/magpie.exe" } })
  assert.equal((await (await call(handler, "api/health", { token: "" })).json()).magpie, "E:/magpie/magpie.exe")
})

test("the list is every Codex model, newest first, with whether Magpie hides it", async () => {
  const runner = fakeMagpie({ exposed: ["gpt-5.6-luna"] })
  const response = await call(serviceFor(runner), "api/state")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("access-control-allow-origin"), "null")
  assert.deepEqual(flags((await response.json()).models), ["gpt-6-luna:hidden", "gpt-5.6-terra:hidden", "gpt-5.6-luna:shown"])
  assert.deepEqual(runner.calls, [["state"]])
})

test("the sandboxed frame's preflight is allowed its token header", async () => {
  const response = await call(serviceFor(fakeMagpie()), "api/apply", {
    method: "OPTIONS",
    token: "",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-codex-model-filter-token",
      "access-control-request-private-network": "true",
    },
  })
  assert.equal(response.status, 204)
  assert.equal(response.headers.get("access-control-allow-origin"), "null")
  assert.equal(response.headers.get("access-control-allow-methods"), "POST")
  assert.match(response.headers.get("access-control-allow-headers"), /x-codex-model-filter-token/)
  assert.equal(response.headers.get("access-control-allow-private-network"), "true")
})

test("no token, another site, a wrong method or path gets nothing from Magpie", async () => {
  const runner = fakeMagpie()
  const handler = serviceFor(runner)
  assert.equal((await call(handler, "api/state", { token: "" })).status, 403)
  assert.equal((await call(handler, "api/state", { token: "test-tokem" })).status, 403)
  assert.equal((await call(handler, "api/state", { headers: { origin: "https://evil.example" } })).status, 403)
  assert.equal((await call(handler, "api/state", { headers: { origin: "http://127.0.0.1:3477", "sec-fetch-site": "cross-site" } })).status, 403)
  assert.equal((await call(handler, "api/apply")).status, 405)
  assert.equal((await call(handler, "api/state", { method: "POST", body: { hidden: [] } })).status, 405)
  assert.equal((await call(handler, "api/nothing")).status, 404)
  assert.deepEqual(runner.calls, [])
})

test("ticking some writes the whole list to show, then checks Magpie and the Codex list", async () => {
  const runner = fakeMagpie()
  const catalog = [{ slug: "gpt-5.6-terra", visibility: "list" }, { slug: "gpt-5.6-luna", visibility: "list" }]
  const response = await apply(serviceFor(runner, { readCatalog: async () => catalog }), ["gpt-6-luna"])
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(runner.calls, [["state"], ["edit", "gpt-5.6-terra", "gpt-5.6-luna"], ["state"]])
  assert.equal(body.changed, true)
  assert.deepEqual(flags(body.models), ["gpt-6-luna:hidden", "gpt-5.6-terra:shown", "gpt-5.6-luna:shown"])
  assert.deepEqual(body.catalog, { status: "verified", file: CATALOG, stillListed: [], notListed: [] })
})

test("ticks Magpie already has write nothing", async () => {
  const runner = fakeMagpie()
  const body = await (await apply(serviceFor(runner), three)).json()
  assert.equal(body.ok, true)
  assert.equal(body.changed, false)
  assert.deepEqual(runner.calls, [["state"]])
})

test("ticking every model serves none", async () => {
  const runner = fakeMagpie({ exposed: three })
  const body = await (await apply(serviceFor(runner), three)).json()
  assert.equal(body.ok, true)
  assert.deepEqual(runner.calls, [["state"], ["edit", "none"], ["state"]])
  assert.ok(body.models.every((model) => model.hidden))
})

test("unticking every model goes back to Magpie's default, and to the whole list when that is shorter", async () => {
  const plain = fakeMagpie()
  assert.equal((await apply(serviceFor(plain), [])).status, 200)
  assert.deepEqual(plain.calls, [["state"], ["edit", "all"], ["state"]])

  const preset = fakeMagpie({ defaults: ["gpt-5.6-luna"] })
  const body = await (await apply(serviceFor(preset), [])).json()
  assert.equal(body.ok, true)
  assert.deepEqual(preset.calls, [["state"], ["edit", "all"], ["state"], ["edit", ...three], ["state"]])
  assert.ok(body.models.every((model) => !model.hidden))
})

test("after a change the Codex list is reported missing, stale or unreadable", async () => {
  const cases = [
    [async () => null, { status: "missing", file: CATALOG }],
    [
      async () => [{ slug: "gpt-6-luna", visibility: "list" }, { slug: "gpt-5.6-luna", visibility: "list" }],
      { status: "stale", file: CATALOG, stillListed: ["gpt-6-luna"], notListed: ["gpt-5.6-terra"] },
    ],
    [async () => { throw new Error("EACCES") }, { status: "unreadable", file: CATALOG, error: "EACCES" }],
  ]
  for (const [readCatalog, expected] of cases) {
    const body = await (await apply(serviceFor(fakeMagpie({ exposed: three }), { readCatalog }), ["gpt-6-luna"])).json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.catalog, expected)
  }
})

test("a bad or unknown selection is refused before anything is written", async () => {
  const runner = fakeMagpie()
  const handler = serviceFor(runner)
  for (const body of ["not json", "{}", JSON.stringify({ hidden: ["codex/gpt-6-luna"] }), JSON.stringify({ hidden: ["x".repeat(17 * 1024)] })]) {
    assert.equal((await call(handler, "api/apply", { method: "POST", body })).status, 400)
  }
  const unknown = await apply(handler, ["gpt-other"])
  assert.equal(unknown.status, 409)
  assert.match((await unknown.json()).error, /gpt-other/)
  assert.deepEqual(runner.calls, [["state"]])
})

test("a switched-off Codex provider is explained, not listed or changed", async () => {
  const runner = fakeMagpie({ disabled: true })
  const handler = serviceFor(runner)
  const listed = await call(handler, "api/state")
  assert.equal(listed.status, 409)
  assert.match((await listed.json()).error, /关闭/)
  assert.equal((await apply(handler, [])).status, 409)
  assert.ok(runner.calls.every(([kind]) => kind === "state"))
})

test("a failing magpie command is an error, with Magpie's list when it is known", async () => {
  const broken = fakeMagpie()
  broken.state = async () => { throw new Error("magpie providers exited 9") }
  const listed = await call(serviceFor(broken), "api/state")
  assert.equal(listed.status, 500)
  assert.match((await listed.json()).error, /exited 9/)

  const runner = fakeMagpie()
  runner.edit = async () => { throw new Error("magpie provider models codex all exited 2") }
  const applied = await apply(serviceFor(runner), [])
  assert.equal(applied.status, 500)
  const body = await applied.json()
  assert.match(body.error, /exited 2/)
  assert.deepEqual(flags(body.models), ["gpt-6-luna:hidden", "gpt-5.6-terra:hidden", "gpt-5.6-luna:hidden"])
})

test("Magpie not saving the ticks is reported, never success", async () => {
  const runner = fakeMagpie()
  runner.edit = async (edits) => { runner.calls.push(["edit", ...edits]) }
  const response = await apply(serviceFor(runner), ["gpt-6-luna"])
  assert.equal(response.status, 502)
  const body = await response.json()
  assert.match(body.error, /gpt-5\.6-terra, gpt-5\.6-luna/)
  assert.ok(body.models.every((model) => model.hidden))
})

test("a second Apply while one runs is refused", async () => {
  const runner = fakeMagpie()
  const edit = runner.edit
  let release
  let entered
  const editing = new Promise((resolve) => { entered = resolve })
  runner.edit = async (edits) => {
    entered()
    await new Promise((resolve) => { release = resolve })
    return edit(edits)
  }
  const handler = serviceFor(runner)
  const first = apply(handler, [])
  await editing
  const second = await apply(handler, [])
  assert.equal(second.status, 409)
  assert.match((await second.json()).error, /还没结束/)
  release()
  assert.equal((await first).status, 200)
})

test("a busy port is tried again, then given up on without throwing", async () => {
  const keepAlive = setInterval(() => {}, 1000)
  try {
    let tries = 0
    const logs = []
    const served = await new Promise((resolve) => {
      startService({ port: 3999 }, {
        serve: (init) => {
          tries += 1
          if (tries < 3) throw new Error("EADDRINUSE")
          resolve(init)
          return { port: init.port }
        },
        log: (line) => logs.push(line),
        retries: 5,
        retryMs: 1,
      })
    })
    assert.equal(tries, 3)
    assert.equal(served.hostname, "127.0.0.1")
    assert.equal(served.port, 3999)
    assert.deepEqual(logs, ["[codex-model-filter] model list on http://127.0.0.1:3999/"])

    const gaveUp = await new Promise((resolve) => {
      startService({ port: 3999 }, { serve: () => { throw new Error("EADDRINUSE") }, log: resolve, retries: 2, retryMs: 1 })
    })
    assert.match(gaveUp, /port 3999 stayed in use.*EADDRINUSE/)
  } finally {
    clearInterval(keepAlive)
  }
})
