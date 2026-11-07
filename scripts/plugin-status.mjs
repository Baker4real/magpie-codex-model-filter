import { createMagpieRunner } from "../lib/cli.mjs"
import { pluginReport } from "../lib/status.mjs"
import { fileURLToPath } from "node:url"

const spec = fileURLToPath(new URL("../", import.meta.url))
const magpiePath = { value: process.env.MAGPIE_EXE || "D:/Apps/magpie/magpie.exe" }
const report = await pluginReport(createMagpieRunner({ magpiePath }), spec)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
