// A local preview of the settings panel: the real page and service against
// a stand-in for Magpie's Codex provider. Apply in the preview changes only
// the stand-in. The page is served at the top level (the in-app browser
// blocks a page's iframes), with a script added that answers its theme call
// as Magpie's window does: at the top level the page's parent is itself.
import http from "node:http"
import { randomBytes } from "node:crypto"
import { createHandler } from "./service.mjs"

// Magpie's plugin-page tokens (internal/gui/pluginpages.js reads them from
// internal/gui/assets/app.css; Windows fonts), copied from Magpie 0.1.3216
const FONT = '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif'
const CODE = '"Cascadia Mono", Consolas, "Microsoft YaHei UI", "Microsoft YaHei", monospace'
export const THEMES = {
  light: {
    dark: false,
    lang: "zh",
    tokens: { bg: "#f4f4f6", card: "#ffffff", fg: "#1c1c21", "fg-2": "#4b4b53", muted: "#85858d", faint: "#b9b9c2", line: "#e3e3e8", accent: "#4f46e5", "accent-soft": "#eeedfd", "accent-fg": "#ffffff", green: "#189a58", red: "#d64545", amber: "#b45309", font: FONT, code: CODE },
  },
  dark: {
    dark: true,
    lang: "zh",
    tokens: { bg: "#1a1a1e", card: "#232327", fg: "#ededf1", "fg-2": "#b9b9c1", muted: "#8b8b94", faint: "#56565f", line: "#333339", accent: "#a5b4fc", "accent-soft": "#2b2c47", "accent-fg": "#14142a", green: "#6fd99b", red: "#f28b82", amber: "#f2b544", font: FONT, code: CODE },
  },
}

const MODELS = ["gpt-6-luna", "gpt-5.6-terra", "gpt-5.6-luna"]

// previewMagpie takes `magpie provider models codex` edits as Magpie does:
// none, all, or the models to show. Its Codex catalog (in readCatalog's
// shape) always follows it.
export function previewMagpie({ models = MODELS, hidden = models } = {}) {
  let shown = models.filter((slug) => !hidden.includes(slug))
  return {
    async state() {
      return { exposed: [...shown], hidden: models.filter((slug) => !shown.includes(slug)), disabled: false, truncated: false }
    },
    async edit(edits) {
      if (edits[0] === "none") shown = []
      else if (edits[0] === "all") shown = [...models]
      else shown = models.filter((slug) => edits.includes(slug))
    },
    async catalog() {
      return models.map((slug) => ({ slug, visibility: shown.includes(slug) ? "list" : "hide" }))
    },
  }
}

function themeAnswer(theme) {
  return `<script>
addEventListener("message", (event) => {
  const message = event.data;
  if (message && message.magpie === 1 && message.method === "theme") postMessage({ magpie: 1, id: message.id, result: ${JSON.stringify(theme)} }, "*");
});
</script>
</html>`
}

// startPreview serves the panel's page at / (?theme=dark for the dark
// tokens) and the service's API beside it on 127.0.0.1; port 0 picks a
// free port.
export async function startPreview({ port = 0, models, hidden } = {}) {
  const magpie = previewMagpie({ models, hidden })
  let handler
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://preview.invalid")
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const request = new Request(`http://${req.headers.host}${url.pathname}`, {
        method: req.method,
        headers: req.headers,
        body: req.method === "GET" || req.method === "HEAD" || !chunks.length ? undefined : Buffer.concat(chunks),
      })
      const response = await handler(request)
      let body = Buffer.from(await response.arrayBuffer())
      if (url.pathname === "/" && response.ok) {
        const theme = THEMES[url.searchParams.get("theme")] || THEMES.light
        body = Buffer.from(body.toString("utf8").replace(/<\/html>\s*$/, () => themeAnswer(theme)))
      }
      const headers = Object.fromEntries(response.headers)
      delete headers["content-length"]
      res.writeHead(response.status, headers)
      res.end(body)
    } catch (error) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" })
      res.end(String(error?.message || error))
    }
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", resolve)
  })
  const actual = server.address().port
  handler = createHandler({
    runner: magpie,
    port: actual,
    token: randomBytes(16).toString("hex"),
    readCatalog: () => magpie.catalog(),
    catalogFile: "(preview)",
  })
  return {
    url: `http://127.0.0.1:${actual}/`,
    close: () => new Promise((resolve) => {
      server.close(resolve)
      server.closeAllConnections()
    }),
  }
}
