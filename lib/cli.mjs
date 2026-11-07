import { spawn as nodeSpawn } from "node:child_process"

const DEFAULT_TIMEOUT_MS = 25_000
const DEFAULT_MAX_OUTPUT = 256 * 1024

export class CliError extends Error {
  constructor(message, { code, timeout = false } = {}) {
    super(message)
    this.name = "CliError"
    this.code = code
    this.timeout = timeout
  }
}

export function stripAnsi(text) {
  return String(text ?? "")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n?/g, "\n")
}

function clipped(text, limit) {
  const value = stripAnsi(text).trim()
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 20))}… [truncated]`
}

export function parseCodexModels(stdout) {
  const text = stripAnsi(stdout)
  const count = text.match(/^\s*models\s+(\d+) exposed of (\d+)\b/m)
  if (!count) throw new CliError("could not read the Codex exposed-model count")
  const exposedCount = Number(count[1])
  const availableCount = Number(count[2])
  const modelLine = /^\s*codex\/([a-z0-9][a-z0-9._-]*)(?:\s|$)/gim
  const exposed = []
  for (const match of text.matchAll(modelLine)) exposed.push(match[1])
  const hiddenLine = text.match(/^\s*not shown\s+(.+?)\s*·/m)
  const hidden = hiddenLine ? hiddenLine[1].split(",").map((id) => id.trim()).filter(Boolean) : []
  const truncated = /…\s*\d+\s+more/i.test(text) || !hiddenLine && exposedCount < availableCount
  if (exposed.length !== exposedCount || exposed.length + hidden.length !== availableCount) {
    throw new CliError("the Codex model list is incomplete; no changes were made")
  }
  if (new Set([...exposed, ...hidden]).size !== availableCount) {
    throw new CliError("the Codex model list contains duplicates or contradictory entries")
  }
  return { exposed, hidden, truncated }
}

export function parseCodexProviderState(stdout) {
  const rows = stripAnsi(stdout).split("\n").map((line) => line.trim().split(/\s{2,}/))
  const cells = rows.filter((cells) => cells.length > 1 && cells[1] === "codex")
  if (cells.length !== 1 || cells[0].length < 5 || !/^\d+(?: of \d+)? models\b/.test(cells[0][4])) {
    throw new CliError("could not read a unique Codex provider state")
  }
  if (cells[0][3] === "○ switched off" || /(?:^|\s)○\s+.+?\s+is switched off(?:\s|$)/.test(cells[0][3])) return { disabled: true }
  if (cells[0][3].startsWith("●")) return { disabled: false }
  throw new CliError("could not read the Codex provider state")
}

function defaultSpawn(file, args, options) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = nodeSpawn(file, args, options)
    } catch (error) {
      reject(error)
      return
    }
    const stdout = []
    const stderr = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const fail = (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length
      if (stdoutBytes <= options.maxOutput) stdout.push(chunk)
    })
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length
      if (stderrBytes <= options.maxOutput) stderr.push(chunk)
    })
    child.on("error", fail)
    child.on("close", (code, signal) => {
      if (settled) return
      settled = true
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
        signal,
        stdoutBytes,
        stderrBytes,
      })
    })
  })
}

export function createMagpieRunner({ magpiePath = { kind: "path", value: "magpie" }, spawn = defaultSpawn, timeoutMs = DEFAULT_TIMEOUT_MS, maxOutput = DEFAULT_MAX_OUTPUT } = {}) {
  const executable = magpiePath?.value
  if (typeof executable !== "string" || !executable.trim()) throw new Error("magpie executable is required")

  async function run(args, { sensitive = false } = {}) {
    const controller = new AbortController()
    let timer
    const timedOut = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new CliError(`magpie ${args.join(" ")} timed out`, { timeout: true }))
      }, timeoutMs)
      timer.unref?.()
    })
    try {
      const result = await Promise.race([
        spawn(executable, args, { shell: false, windowsHide: true, signal: controller.signal, maxOutput }),
        timedOut,
      ])
      if (result.aborted) throw new CliError(`magpie ${args.join(" ")} timed out`, { timeout: true })
      if ((result.stdoutBytes ?? Buffer.byteLength(result.stdout ?? "")) > maxOutput || (result.stderrBytes ?? Buffer.byteLength(result.stderr ?? "")) > maxOutput) {
        throw new CliError("magpie command output exceeded the limit")
      }
      if (result.code !== 0) {
        const detail = sensitive ? "" : clipped(result.stderr || result.stdout, 600)
        throw new CliError(`magpie ${args.join(" ")} exited ${result.code ?? result.signal}${detail ? ": " + detail : ""}`, { code: result.code })
      }
      return result
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async state() {
      const provider = await run(["providers"], { sensitive: true })
      const { disabled } = parseCodexProviderState(provider.stdout)
      if (disabled) return { exposed: [], hidden: [], disabled, truncated: false }
      const result = await run(["provider", "models", "codex"])
      return { ...parseCodexModels(result.stdout), disabled }
    },
    async providerState() {
      const result = await run(["providers"], { sensitive: true })
      return parseCodexProviderState(result.stdout)
    },
    async edit(edits) {
      await run(["provider", "models", "codex", ...edits])
    },
    async pluginState() {
      const result = await run(["plugin", "--json"])
      try {
        return JSON.parse(result.stdout)
      } catch {
        throw new CliError("could not parse the Magpie plugin state")
      }
    },
    async version() {
      const result = await run(["--version"])
      const match = stripAnsi(result.stdout).match(/\bmagpie\s+v?(\d+(?:\.\d+)+)\b/i)
      if (!match) throw new CliError("could not read the Magpie version")
      return match[1]
    },
    async logPath() {
      const result = await run(["log", "--path"])
      const file = stripAnsi(result.stdout).split("\n").map((line) => line.trim()).filter(Boolean).at(-1)
      if (!file) throw new CliError("could not read the Magpie log path")
      return file
    },
    // Magpie restarts its whole plugin host after every options write, so
    // writing a plugin's options back unchanged reloads it; null clears them
    async setPluginOptions(spec, options) {
      await run(["plugin", "options", spec, options ? JSON.stringify(options) : "off"])
    },
  }
}
