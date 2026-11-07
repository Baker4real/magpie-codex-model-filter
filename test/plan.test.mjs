import assert from "node:assert/strict"
import test from "node:test"
import { buildPlan, listModels, sortModels, stateRefusal, verifyState } from "../lib/plan.mjs"

const three = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"]
const allHidden = { exposed: [], hidden: [...three], truncated: false }
const allShown = { exposed: [...three], hidden: [], truncated: false }

test("models are listed newest first with whether Magpie hides each", () => {
  assert.deepEqual(sortModels(["gpt-5.6-luna", "gpt-6-luna", "gpt-5.6-terra", "gpt-5.10-x"]), ["gpt-6-luna", "gpt-5.10-x", "gpt-5.6-terra", "gpt-5.6-luna"])
  assert.deepEqual(listModels({ exposed: ["gpt-5.6-luna"], hidden: ["gpt-6-luna", "gpt-5.6-terra"] }), [
    { slug: "gpt-6-luna", hidden: true },
    { slug: "gpt-5.6-terra", hidden: true },
    { slug: "gpt-5.6-luna", hidden: false },
  ])
})

test("a selection Magpie already has writes nothing", () => {
  assert.deepEqual(buildPlan(allHidden, [...three]).commands, [])
  assert.deepEqual(buildPlan(allShown, []).commands, [])
})

test("hiding every model selects none", () => {
  const plan = buildPlan(allShown, [...three])
  assert.deepEqual(plan.commands, [["none"]])
  assert.deepEqual(plan.toHide, three)
})

test("showing every model goes back to Magpie's default, with the whole list as fallback", () => {
  const plan = buildPlan(allHidden, [])
  assert.deepEqual(plan.commands, [["all"]])
  assert.deepEqual(plan.fallback, three)
  assert.deepEqual(plan.toShow, three)
})

test("hiding some writes the whole list of models to show", () => {
  const plan = buildPlan(allHidden, ["gpt-6-luna"])
  assert.deepEqual(plan.commands, [["gpt-5.6-terra", "gpt-5.6-luna"]])
  assert.deepEqual(plan.toShow, ["gpt-5.6-terra", "gpt-5.6-luna"])
  assert.deepEqual(plan.toHide, [])
  assert.equal(plan.fallback, null)
})

test("verifyState names each model Magpie doesn't have as wanted", () => {
  const plan = buildPlan(allHidden, ["gpt-6-luna"])
  assert.deepEqual(verifyState({ exposed: ["gpt-5.6-terra", "gpt-5.6-luna"], hidden: ["gpt-6-luna"] }, plan), [])
  assert.deepEqual(verifyState(allHidden, plan), ["gpt-5.6-terra", "gpt-5.6-luna"])
})

test("unknown models, a switched-off provider and a cut list are refused", () => {
  assert.equal(stateRefusal(allHidden), "")
  assert.throws(() => buildPlan(allHidden, ["gpt-other"]), /gpt-other/)
  assert.throws(() => buildPlan({ ...allHidden, disabled: true }, []), /关闭/)
  assert.throws(() => buildPlan({ ...allHidden, truncated: true }, []), /截断/)
  assert.throws(() => buildPlan({ exposed: [], hidden: [] }, []), /没有列出/)
  assert.throws(() => buildPlan(null, []), /读不懂/)
})
