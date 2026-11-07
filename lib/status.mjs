import { open } from "node:fs/promises"
import { resolveOptions } from "./config.mjs"

const LOG_TAG = "[codex-model-filter]"
const HEALTH_SCOPE = "codex-provider-picks"

function normalizeSpec(spec) {
  return String(spec).replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase()
}

// findPluginEntry is this plugin's one entry in `magpie plugin --json`.
export function findPluginEntry(state, spec) {
  if (typeof spec !== "string" || !spec) throw new Error("plugin spec is required")
  if (!state || !Array.isArray(state.plugins) || !Array.isArray(state.loaded)) throw new Error("invalid Magpie plugin state")
  const entries = state.plugins.filter((entry) => normalizeSpec(entry?.spec) === normalizeSpec(spec))
  if (entries.length !== 1) throw new Error(entries.length ? "plugin registration is ambiguous" : "plugin is not registered")
  const entry = entries[0]
  if (typeof entry.spec !== "string" || entry.off !== undefined && typeof entry.off !== "boolean") throw new Error("invalid Magpie plugin entry")
  const loaded = state.loaded.some((item) => normalizeSpec(item?.spec) === normalizeSpec(entry.spec))
  return { entry, loaded }
}

export async function projectPluginStatus(runner, spec) {
  if (typeof spec !== "string" || !spec) throw new Error("plugin spec is required")
  const { entry, loaded } = findPluginEntry(await runner.pluginState(), spec)
  return { spec: entry.spec, off: entry.off ?? !loaded, loaded }
}

// probeService asks the port for this plugin's /api/health. Whether the
// service listens is decided here: Get-NetTCPConnection -State Listen does
// not list Bun's listening socket.
export async function probeService(port, { fetch = globalThis.fetch, timeoutMs = 2000 } = {}) {
  let response
  try {
    response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    return { ok: false, error: `nothing answered on 127.0.0.1:${port} (${error?.cause?.code || error?.name || "error"})` }
  }
  const body = await response.json().catch(() => null)
  if (response.ok && body?.ok === true && body.scope === HEALTH_SCOPE) return { ok: true }
  return { ok: false, error: `127.0.0.1:${port} answered ${response.status}, not this plugin's health` }
}

// pageToken is the token in the page the service serves. Every start of the
// service draws a new one, so a new token means a new service process; it
// stays in memory and is never printed.
export async function pageToken(port, { fetch = globalThis.fetch, timeoutMs = 2000 } = {}) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return null
    const match = (await response.text()).match(/<meta name="codex-model-filter-token" content="([0-9a-f]+)">/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

export function pluginLogLines(text, limit = 8) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((line) => line.includes(LOG_TAG))
    .map((line) => line.trim())
    .slice(-limit)
}

// readLogTail reads the end of Magpie's log. Magpie keeps the file open for
// writing: .NET's File.ReadAllLines is refused, Node's shared read is not.
export async function readLogTail(file, bytes = 256 * 1024) {
  const handle = await open(file, "r")
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString("utf8")
  } finally {
    await handle.close()
  }
}

// pluginReport is what `npm run status` prints: the registration, the Magpie
// version, whether the service answers, and this plugin's own log lines.
// Nothing else from `magpie plugin --json` or the log is passed on.
export async function pluginReport(runner, spec, { fetch = globalThis.fetch, readLog = readLogTail, logLines = 8 } = {}) {
  const { entry, loaded } = findPluginEntry(await runner.pluginState(), spec)
  const { port } = resolveOptions(entry.options ?? {})
  const report = { spec: entry.spec, off: entry.off ?? !loaded, loaded, port }
  try {
    report.magpie = await runner.version()
  } catch (error) {
    report.magpie = `unknown (${error.message})`
  }
  const health = await probeService(port, { fetch })
  report.service = health.ok ? "ok" : health.error
  try {
    report.log = pluginLogLines(await readLog(await runner.logPath()), logLines)
  } catch (error) {
    report.log = [`could not read the Magpie log: ${error.message}`]
  }
  return report
}

// reloadPlugin writes the plugin's options back unchanged, which makes
// Magpie restart its plugin host, and waits until the page on the plugin's
// port carries a new token that holds for a few polls: a magpie CLI command
// starts a host of its own that can hold the port for a moment.
export async function reloadPlugin(runner, spec, { fetch = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeoutMs = 20_000, intervalMs = 500, steadyPolls = 3 } = {}) {
  const { entry } = findPluginEntry(await runner.pluginState(), spec)
  if (entry.off === true) throw new Error("the plugin is switched off in Magpie; switch it on first")
  const { port } = resolveOptions(entry.options ?? {})
  const before = await pageToken(port, { fetch })
  await runner.setPluginOptions(entry.spec, entry.options ?? null)
  const deadline = Date.now() + timeoutMs
  let seen = null
  let steady = 0
  while (steady < steadyPolls && Date.now() < deadline) {
    await sleep(intervalMs)
    const now = await pageToken(port, { fetch })
    if (now && now !== before) {
      steady = now === seen ? steady + 1 : 1
      seen = now
    } else {
      seen = null
      steady = 0
    }
  }
  const health = await probeService(port, { fetch })
  return { spec: entry.spec, port, restarted: steady >= steadyPolls, service: health.ok ? "ok" : health.error }
}
