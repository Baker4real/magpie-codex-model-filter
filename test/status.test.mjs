import assert from "node:assert/strict"
import test from "node:test"
import { pluginLogLines, pluginReport, projectPluginStatus, reloadPlugin } from "../lib/status.mjs"

const spec = "D:/agents/projects/magpie-codex-model-filter"
const health = () => Response.json({ ok: true, magpie: "D:/Apps/magpie/magpie.exe", scope: "codex-provider-picks" })
const page = (token) => new Response(`<meta name="codex-model-filter-token" content="${token}">`, { headers: { "content-type": "text/html" } })
const refused = () => Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })

test("plugin status projects only spec, off and loaded for the registered path", async () => {
  const runner = {
    async pluginState() {
      return {
        plugins: [{ spec, options: { token: "private" } }],
        loaded: [{ spec, provides: ["private"] }],
        providers: [{ account: "private" }],
      }
    },
  }
  const status = await projectPluginStatus(runner, spec)
  assert.deepEqual(status, { spec, off: false, loaded: true })
  assert.equal(JSON.stringify(status).includes("private"), false)
})

test("plugin status normalizes Windows separators and rejects unknown or invalid entries", async () => {
  const runner = { async pluginState() { return { plugins: [{ spec: spec.replaceAll("/", "\\") }], loaded: [] } } }
  assert.deepEqual(await projectPluginStatus(runner, spec), { spec: spec.replaceAll("/", "\\"), off: true, loaded: false })
  await assert.rejects(projectPluginStatus({ async pluginState() { return { plugins: [], loaded: [] } } }, spec), /not registered/)
  await assert.rejects(projectPluginStatus({ async pluginState() { return { plugins: [{ spec, off: "private" }], loaded: [] } } }, spec), /invalid/)
})

test("the status report adds the Magpie version, the service's health and only this plugin's log lines", async () => {
  const runner = {
    async pluginState() {
      return { plugins: [{ spec, options: { port: 3490, token: "private" } }], loaded: [{ spec }], providers: [{ account: "private" }] }
    },
    async version() { return "0.1.3230" },
    async logPath() { return "D:/logs/app.log" },
  }
  const fetch = async (url) => {
    assert.equal(url, "http://127.0.0.1:3490/api/health")
    return health()
  }
  const log = "2026/11/07 15:00:00 provider: private-account signed in\r\n2026/11/07 15:00:01 [codex-model-filter] model list on http://127.0.0.1:3490/\r\n"
  const readLog = async (file) => {
    assert.equal(file, "D:/logs/app.log")
    return log
  }
  const report = await pluginReport(runner, spec, { fetch, readLog })
  assert.deepEqual(report, {
    spec,
    off: false,
    loaded: true,
    port: 3490,
    magpie: "0.1.3230",
    service: "ok",
    log: ["2026/11/07 15:00:01 [codex-model-filter] model list on http://127.0.0.1:3490/"],
  })
  assert.equal(JSON.stringify(report).includes("private"), false)
})

test("the status report names what is wrong instead of failing", async () => {
  const runner = {
    async pluginState() { return { plugins: [{ spec }], loaded: [] } },
    async version() { throw new Error("magpie --version exited 1") },
    async logPath() { throw new Error("magpie log --path exited 1") },
  }
  const down = await pluginReport(runner, spec, { fetch: async () => { throw refused() } })
  assert.equal(down.port, 3477)
  assert.equal(down.off, true)
  assert.match(down.magpie, /^unknown \(/)
  assert.equal(down.service, "nothing answered on 127.0.0.1:3477 (ECONNREFUSED)")
  assert.match(down.log[0], /could not read the Magpie log/)
  const other = await pluginReport(runner, spec, { fetch: async () => new Response("not found", { status: 404 }) })
  assert.equal(other.service, "127.0.0.1:3477 answered 404, not this plugin's health")
})

test("pluginLogLines keeps the last lines tagged by this plugin", () => {
  const text = `${Array.from({ length: 12 }, (_, i) => `t${i} [codex-model-filter] line ${i}`).join("\n")}\nt12 other plugin`
  assert.deepEqual(pluginLogLines(text, 2), ["t10 [codex-model-filter] line 10", "t11 [codex-model-filter] line 11"])
})

// what the plugin's port serves on each poll, the last one from then on
function servedPages(before) {
  let pages = [before]
  return {
    after(next) { pages = next },
    async fetch(url) {
      if (url.endsWith("/api/health")) return health()
      const token = pages.length > 1 ? pages.shift() : pages[0]
      if (!token) throw refused()
      return page(token)
    },
  }
}

test("reload writes the options back unchanged and waits for a new service that holds", async () => {
  const options = { magpiePath: "D:/Apps/magpie/magpie.exe", port: 3477 }
  const port = servedPages("aaaa")
  const writes = []
  const runner = {
    async pluginState() { return { plugins: [{ spec, options }], loaded: [{ spec }] } },
    async setPluginOptions(...args) {
      writes.push(args)
      // the port goes quiet, a magpie CLI host answers once, then the app's new host
      port.after([null, "bbbb", "cccc"])
    },
  }
  const result = await reloadPlugin(runner, spec, { fetch: port.fetch, sleep: async () => {} })
  assert.deepEqual(writes, [[spec, options]])
  assert.deepEqual(result, { spec, port: 3477, restarted: true, service: "ok" })
})

test("reload says so when no new service came back, and leaves a switched-off plugin alone", async () => {
  const port = servedPages("aaaa")
  const writes = []
  const runner = {
    async pluginState() { return { plugins: [{ spec }], loaded: [{ spec }] } },
    async setPluginOptions(...args) { writes.push(args) },
  }
  const result = await reloadPlugin(runner, spec, { fetch: port.fetch, sleep: async () => {}, timeoutMs: 20 })
  assert.deepEqual(writes, [[spec, null]])
  assert.equal(result.restarted, false)
  const off = { async pluginState() { return { plugins: [{ spec, off: true }], loaded: [] } }, async setPluginOptions() { throw new Error("must not write") } }
  await assert.rejects(reloadPlugin(off, spec, { fetch: port.fetch }), /switched off/)
})
