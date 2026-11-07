import { randomBytes, timingSafeEqual } from "node:crypto"
import { normalizeHidden, resolveOptions } from "./config.mjs"
import { createMagpieRunner } from "./cli.mjs"
import { buildPlan, listModels, stateRefusal, verifyState } from "./plan.mjs"
import { catalogMismatches, codexCatalogPath, readCatalog } from "./catalog.mjs"
import { renderPage } from "./page.mjs"

const MAX_BODY = 16 * 1024
const TOKEN_HEADER = "x-codex-model-filter-token"

function json(value, status = 200, extra = {}) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra },
  })
}

function messageOf(error, fallback = "magpie 命令失败") {
  return error?.message || fallback
}

export function createHandler(config) {
  const state = {
    runner: config.runner,
    readCatalog: config.readCatalog ?? (() => readCatalog()),
    catalogFile: config.catalogFile ?? codexCatalogPath(),
    port: config.port,
    token: typeof config.token === "string" ? config.token : "",
    magpie: typeof config.magpie === "string" ? config.magpie : "magpie",
    busy: false,
  }
  if (!state.runner) throw new Error("runner is required")

  async function run(commands) {
    for (const edits of commands) {
      await state.runner.edit(edits)
      console.log(`[codex-model-filter] magpie provider models codex ${edits.join(" ")}`)
    }
    return state.runner.state()
  }

  // whether the Codex app's own list (Magpie writes it) shows the change yet
  async function catalogStatus(plan) {
    const file = state.catalogFile
    let catalog
    try {
      catalog = await state.readCatalog()
    } catch (error) {
      return { status: "unreadable", file, error: messageOf(error, "读不了") }
    }
    if (catalog === null) return { status: "missing", file }
    const { stillListed, notListed } = catalogMismatches(catalog, plan)
    return { status: stillListed.length || notListed.length ? "stale" : "verified", file, stillListed, notListed }
  }

  async function readState(cors) {
    try {
      const current = await state.runner.state()
      const refusal = stateRefusal(current)
      if (refusal) return json({ ok: false, error: refusal }, 409, cors)
      return json({ ok: true, models: listModels(current) }, 200, cors)
    } catch (error) {
      return json({ ok: false, error: messageOf(error) }, 500, cors)
    }
  }

  async function apply(request, cors) {
    let hidden
    try {
      const text = await request.text()
      if (text.length > MAX_BODY) throw new Error("请求太大")
      hidden = normalizeHidden(JSON.parse(text || "{}")?.hidden)
    } catch (error) {
      return json({ ok: false, error: messageOf(error, "请求格式不对") }, 400, cors)
    }
    if (state.busy) return json({ ok: false, error: "上一次应用还没结束" }, 409, cors)
    state.busy = true
    let models
    try {
      const before = await state.runner.state()
      let plan
      try {
        plan = buildPlan(before, hidden)
      } catch (error) {
        return json({ ok: false, error: messageOf(error) }, 409, cors)
      }
      models = listModels(before)
      if (!plan.commands.length) return json({ ok: true, changed: false, models }, 200, cors)
      let after = await run(plan.commands)
      let wrong = verifyState(after, plan)
      if (wrong.length && plan.fallback) {
        after = await run([plan.fallback])
        wrong = verifyState(after, plan)
      }
      models = listModels(after)
      if (wrong.length) return json({ ok: false, error: `Magpie 没有按勾选保存：${wrong.join(", ")}`, models }, 502, cors)
      return json({ ok: true, changed: true, models, catalog: await catalogStatus(plan) }, 200, cors)
    } catch (error) {
      return json({ ok: false, error: messageOf(error), ...(models ? { models } : {}) }, 500, cors)
    } finally {
      state.busy = false
    }
  }

  const handler = async function handler(request) {
    const url = new URL(request.url)
    const host = String(request.headers.get("host") || "").toLowerCase()
    const allowedHost = state.port > 0 ? [`127.0.0.1:${state.port}`, `localhost:${state.port}`] : null
    if (allowedHost && !allowedHost.includes(host)) return new Response("Forbidden", { status: 403 })

    if (url.pathname === "/" && request.method === "GET") {
      return new Response(renderPage({ token: state.token, port: state.port }), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
          "referrer-policy": "no-referrer",
        },
      })
    }
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, magpie: state.magpie, scope: "codex-provider-picks" })
    }
    const method = { "/api/state": "GET", "/api/apply": "POST" }[url.pathname]
    if (!method) return json({ ok: false, error: "not found" }, 404)

    // the settings panel's frame is sandboxed, so its requests say
    // Origin: null; anything else is this page's own origin or nobody's
    const origin = request.headers.get("origin")
    const localOrigins = state.port > 0 ? [`http://127.0.0.1:${state.port}`, `http://localhost:${state.port}`] : []
    if (origin && origin !== "null" && !localOrigins.includes(origin) || request.headers.get("sec-fetch-site") === "cross-site" && origin !== "null") {
      return json({ ok: false, error: "forbidden origin" }, 403)
    }
    const cors = origin === "null" ? { "access-control-allow-origin": "null", vary: "origin" } : {}
    if (request.method === "OPTIONS") {
      const headers = {
        ...cors,
        "access-control-allow-methods": method,
        "access-control-allow-headers": `content-type, ${TOKEN_HEADER}`,
        "access-control-max-age": "600",
      }
      if (request.headers.get("access-control-request-private-network") === "true") headers["access-control-allow-private-network"] = "true"
      return new Response(null, { status: 204, headers })
    }
    if (request.method !== method) return json({ ok: false, error: "method not allowed" }, 405, cors)
    const supplied = request.headers.get(TOKEN_HEADER) || ""
    const valid = state.token.length > 0 && supplied.length === state.token.length && timingSafeEqual(Buffer.from(supplied), Buffer.from(state.token))
    if (!valid) return json({ ok: false, error: "请从 Magpie 设置里的插件面板打开" }, 403, cors)

    return url.pathname === "/api/state" ? readState(cors) : apply(request, cors)
  }
  handler.update = (next) => {
    if (next.magpiePath !== undefined) {
      state.runner = createMagpieRunner({ magpiePath: next.magpiePath })
      state.magpie = next.magpiePath.value
    }
  }
  return handler
}

// startService serves the model list on 127.0.0.1. The port can still be
// held for a moment by the host Magpie is replacing, and a magpie CLI
// command starts a host of its own beside the app's, so a busy port is
// tried again for a while and then left: never thrown into the host.
export function startService(options, { serve = (init) => Bun.serve(init), log = console.log, retries = 20, retryMs = 500 } = {}) {
  const resolved = resolveOptions(options)
  const token = randomBytes(24).toString("hex")
  const handler = createHandler({
    runner: createMagpieRunner({ magpiePath: resolved.magpiePath }),
    port: resolved.port,
    token,
    magpie: resolved.magpiePath.value,
  })
  const service = { handler, token, resolved, server: null }
  let attempt = 0
  const listen = () => {
    try {
      service.server = serve({ hostname: "127.0.0.1", port: resolved.port, fetch: handler })
      log(`[codex-model-filter] model list on http://127.0.0.1:${service.server.port}/`)
    } catch (error) {
      attempt += 1
      if (attempt > retries) {
        log(`[codex-model-filter] port ${resolved.port} stayed in use; this process doesn't serve the model list (${messageOf(error, "bind failed")})`)
        return
      }
      setTimeout(listen, retryMs).unref?.()
    }
  }
  listen()
  return service
}

export default {
  id: "magpie-codex-model-filter",
  async server(_input, options) {
    const current = globalThis.__magpieCodexModelFilter
    if (current) {
      current.handler.update({ magpiePath: resolveOptions(options).magpiePath })
      return {}
    }
    globalThis.__magpieCodexModelFilter = startService(options)
    return {}
  },
}
