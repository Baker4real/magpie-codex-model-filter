import assert from "node:assert/strict"
import test from "node:test"
import { normalizeHidden, resolveOptions } from "../lib/config.mjs"

test("hidden models are trimmed, deduplicated bare slugs, and may be none", () => {
  assert.deepEqual(normalizeHidden([]), [])
  assert.deepEqual(normalizeHidden([" gpt-6-luna ", "GPT-6-LUNA", "gpt-5.6-luna"]), ["gpt-6-luna", "gpt-5.6-luna"])
  for (const bad of [undefined, "gpt-6-luna", [""], [42], ["codex/gpt-6-luna"], ["../gpt-6-luna"], ["gpt-*"], ['gpt-6-luna"; rm -rf /'], ["gpt 6 luna"], ["-gpt-6-luna"], ["+gpt-6-luna"]]) {
    assert.throws(() => normalizeHidden(bad), /slug|列表/)
  }
  assert.throws(() => normalizeHidden(Array.from({ length: 201 }, (_, i) => `m${i}`)), /太多/)
})

test("options are the Magpie path and the port; a 0.1.x hiddenModels is ignored", () => {
  assert.deepEqual(Object.keys(resolveOptions({ hiddenModels: ["gpt-6-luna"] })).sort(), ["magpiePath", "port"])
})

test("magpiePath defaults to PATH lookup and accepts an explicit absolute executable", () => {
  assert.deepEqual(resolveOptions({}).magpiePath, { kind: "path", value: "magpie" })
  assert.deepEqual(resolveOptions({ magpiePath: " D:/Apps/magpie/magpie.exe " }).magpiePath, {
    kind: "absolute",
    value: "D:/Apps/magpie/magpie.exe",
  })
  assert.deepEqual(resolveOptions({ magpiePath: "C:/Program Files/magpie/magpie.exe" }).magpiePath, {
    kind: "absolute",
    value: "C:/Program Files/magpie/magpie.exe",
  })
  for (const bad of ["relative/magpie.exe", "./magpie", "C:/x/magpie.exe --json"]) {
    assert.throws(() => resolveOptions({ magpiePath: bad }), /magpiePath/i)
  }
})

test("service port is a valid loopback TCP port", () => {
  assert.equal(resolveOptions({}).port, 3477)
  assert.equal(resolveOptions({ port: 4000 }).port, 4000)
  for (const bad of [80, 0, 65536, "3477x", 3477.5]) {
    assert.throws(() => resolveOptions({ port: bad }), /port/i)
  }
})
