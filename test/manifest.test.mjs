import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

test("the manifest adds a Settings › Plugins panel and no sidebar page", async () => {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"))
  assert.equal(pkg.main, "./service.mjs")
  assert.equal(pkg.magpie.page, undefined)
  assert.deepEqual(pkg.magpie.options, { magpiePath: "D:/Apps/magpie/magpie.exe", port: 3477 })
  assert.deepEqual(pkg.magpie.panels, [
    { slot: "settings", title: "Codex model filter", titles: { zh: "Codex 模型过滤" }, file: "panel/index.html" },
  ])
  const html = await fs.readFile(path.join(root, "panel/index.html"), "utf8")
  assert.match(html, /<script src="_magpie\/bridge\.js"><\/script>/)
  assert.match(html, /<script src="panel\.js"><\/script>/)
  await Promise.all([...pkg.files, "panel/panel.js"].map((file) => fs.access(path.join(root, file))))
})
