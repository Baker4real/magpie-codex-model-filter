// Loads this folder's current code into the running Magpie: writes the
// plugin's options back unchanged (Magpie then restarts its plugin host,
// every plugin with it) and waits for a new service process on the port.
import { createMagpieRunner } from "../lib/cli.mjs"
import { reloadPlugin } from "../lib/status.mjs"
import { fileURLToPath } from "node:url"

const spec = fileURLToPath(new URL("../", import.meta.url))
const magpiePath = { value: process.env.MAGPIE_EXE || "D:/Apps/magpie/magpie.exe" }
const result = await reloadPlugin(createMagpieRunner({ magpiePath }), spec)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (!result.restarted || result.service !== "ok") process.exitCode = 1
