import assert from "node:assert/strict"
import test from "node:test"
import { CliError, createMagpieRunner, parseCodexModels, parseCodexProviderState, stripAnsi } from "../lib/cli.mjs"

const three = `  models     0 exposed of 3 from chatgpt.com
  not shown  gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna · none picked, so only the first 0
`

test("parseCodexModels reads the current three-model zero-pick state", () => {
  assert.deepEqual(parseCodexModels(three), { exposed: [], hidden: ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"], truncated: false })
})

test("parseCodexModels distinguishes exposed and hidden models and strips ANSI", () => {
  const text = `  models     1 exposed of 2
             codex/gpt-6-luna  6 Luna
  not shown  gpt-5.6-terra · not picked
`
  assert.deepEqual(parseCodexModels(text), { exposed: ["gpt-6-luna"], hidden: ["gpt-5.6-terra"], truncated: false })
  assert.equal(stripAnsi("\u001b[1mgpt-6-luna\u001b[0m\r\n"), "gpt-6-luna\n")
})

test("parseCodexModels does not infer none from counts", () => {
  assert.equal(parseCodexModels("models 0 exposed of 0\n").disabled, undefined)
  assert.equal(parseCodexModels(three).servesNone, undefined)
})

test("parseCodexProviderState reads only the codex provider's actual off marker", () => {
  assert.throws(() => parseCodexProviderState("  ChatGPT  codex  chatgpt.com  account@example.test  0 of 3 models  magpie provider on codex\n"), /could not read/i)
  assert.deepEqual(parseCodexProviderState("  ChatGPT  codex  chatgpt.com  ○ switched off  0 of 3 models  magpie provider on codex\n"), { disabled: true })
  assert.deepEqual(parseCodexProviderState("  ChatGPT  codex  chatgpt.com  ● account  0 of 3 models  magpie provider on codex\n"), { disabled: false })
  assert.throws(() => parseCodexProviderState("  ChatGPT  codex  chatgpt.com  ? unknown  0 of 3 models\n"), /could not read/i)
  assert.throws(() => parseCodexProviderState("  Other  other  example.test  ● account  2 models  codex\n"), /could not read/i)
  assert.throws(() => parseCodexProviderState("  Other  other  example.test  no key needed  2 models\n"), /could not read/i)
})

test("parseCodexModels rejects truncation, missing models and contradictions", () => {
  assert.throws(() => parseCodexModels("models 0 exposed of 4\nnot shown gpt-6-luna · not picked"), /incomplete/i)
  assert.throws(() => parseCodexModels("models 1 exposed of 1\n"), /incomplete/i)
  assert.throws(() => parseCodexModels("models 0 exposed of 1\n"), /incomplete/i)
  assert.throws(() => parseCodexModels("no models"), /could not read/i)
})

test("runner uses argv array without a shell, including a path with spaces", async () => {
  const calls = []
  const runner = createMagpieRunner({
    magpiePath: { value: "C:/Program Files/magpie/magpie.exe" },
    spawn: (file, args, options) => {
      calls.push({ file, args, options })
      return Promise.resolve({ stdout: args[0] === "providers" ? "  ChatGPT  codex  chatgpt.com  ● no key needed  3 models\n" : three, stderr: "", code: 0 })
    },
  })
  await runner.state()
  await runner.providerState()
  await runner.edit(["+gpt-6-luna"])
  assert.deepEqual(calls.map((call) => call.args), [["providers"], ["provider", "models", "codex"], ["providers"], ["provider", "models", "codex", "+gpt-6-luna"]])
  assert.equal(calls[0].options.shell, false)
})

test("runner reports non-zero status, timeout and oversized output", async () => {
  const failure = createMagpieRunner({ spawn: () => Promise.resolve({ stdout: "", stderr: "x".repeat(5000), code: 7 }) })
  await assert.rejects(failure.state(), (error) => error instanceof CliError && /exited 7/.test(error.message) && error.message.length < 1500)
  const timeout = createMagpieRunner({ timeoutMs: 20, spawn: (_file, _args, options) => new Promise((resolve) => {
    options.signal.addEventListener("abort", () => resolve({ stdout: "", stderr: "", code: null, aborted: true }), { once: true })
  }) })
  await assert.rejects(timeout.state(), /timed out/i)
  const large = createMagpieRunner({ maxOutput: 32, spawn: () => Promise.resolve({ stdout: "y".repeat(64), stderr: "", code: 0 }) })
  await assert.rejects(large.state(), /exceeded/i)
})

test("runner reads the version and log path and writes plugin options as one JSON argument", async () => {
  const calls = []
  const stdout = { "--version": "magpie 0.1.3230\n", log: "C:\\Users\\me\\AppData\\Local\\magpie\\logs\\app.log\r\n", plugin: "✓ options set\n" }
  const runner = createMagpieRunner({
    spawn: (_file, args) => {
      calls.push(args)
      return Promise.resolve({ stdout: stdout[args[0]], stderr: "plugin: host starts", code: 0 })
    },
  })
  assert.equal(await runner.version(), "0.1.3230")
  assert.equal(await runner.logPath(), "C:\\Users\\me\\AppData\\Local\\magpie\\logs\\app.log")
  await runner.setPluginOptions("D:\\plugins\\x", { magpiePath: "D:/Apps/magpie/magpie.exe", port: 3477 })
  await runner.setPluginOptions("D:\\plugins\\x", null)
  assert.deepEqual(calls, [
    ["--version"],
    ["log", "--path"],
    ["plugin", "options", "D:\\plugins\\x", '{"magpiePath":"D:/Apps/magpie/magpie.exe","port":3477}'],
    ["plugin", "options", "D:\\plugins\\x", "off"],
  ])
  const blank = createMagpieRunner({ spawn: () => Promise.resolve({ stdout: "\n", stderr: "", code: 0 }) })
  await assert.rejects(blank.version(), /version/)
  await assert.rejects(blank.logPath(), /log path/)
})

test("provider state failures do not echo account columns", async () => {
  const runner = createMagpieRunner({ spawn: () => Promise.resolve({ stdout: "private-account", stderr: "private-account", code: 8 }) })
  await assert.rejects(runner.providerState(), (error) => /exited 8/.test(error.message) && !error.message.includes("private-account"))
})
