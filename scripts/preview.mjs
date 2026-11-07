// npm run preview [-- --port <n>]: the settings panel against a stand-in
// Magpie, for looking at it in a browser without touching real settings.
import { startPreview } from "../lib/preview.mjs"

const at = process.argv.indexOf("--port")
const port = at > 0 ? Number(process.argv[at + 1]) : 0
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port takes a port number (0 picks a free one)")
const preview = await startPreview({ port })
process.stdout.write(`preview on ${preview.url} (Magpie's light tokens) and ${preview.url}?theme=dark; Apply changes only stand-in data; Ctrl+C stops it\n`)
