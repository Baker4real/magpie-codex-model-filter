// The model list the settings panel shows. The plugin's panel page (served
// by Magpie, panel/index.html) sends its frame here, so this page sits in
// Magpie's Settings > Plugins tab: it tells the window its height and takes
// the window's theme by the same messages Magpie's page bridge sends
// ({magpie: 1, method: "size" | "theme"}), and reaches this service with the
// token it was served with. The frame stays sandboxed: its fetches come from
// an opaque origin (Origin: null), which the service answers with CORS.

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

const CSS = `
:root{color-scheme:light dark;--bg:var(--magpie-bg,Canvas);--card:var(--magpie-card,Canvas);--fg:var(--magpie-fg,CanvasText);--muted:var(--magpie-muted,GrayText);--line:var(--magpie-line,color-mix(in srgb,GrayText 35%,transparent));--accent:var(--magpie-accent,AccentColor);--accent-fg:var(--magpie-accent-fg,AccentColorText);--good:var(--magpie-green,#16843b);--bad:var(--magpie-red,#c43b3b);--warn:var(--magpie-amber,#b7791f)}
html{background:var(--bg);color:var(--fg);font:13px/1.45 var(--magpie-font,-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif)}
body{margin:0;padding:2px 2px 6px}
p{margin:0 0 10px}
.lead{color:var(--muted)}
.models{list-style:none;margin:0 0 12px;padding:0;border:1px solid var(--line);border-radius:8px;background:var(--card)}
.models li+li{border-top:1px solid var(--line)}
.models label{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer}
.models input{margin:0;width:15px;height:15px;accent-color:var(--accent);flex:none}
.models code{flex:1;min-width:0;overflow-wrap:anywhere;font:12px/1.4 var(--magpie-code,ui-monospace,Menlo,Consolas,monospace)}
.models .now{color:var(--muted);font-size:12px;white-space:nowrap}
.models .now.change{color:var(--accent);font-weight:600}
.models .empty{padding:10px 12px;color:var(--muted)}
.bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
button{font:inherit;color:inherit;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:4px 12px;cursor:pointer}
button.primary{background:var(--accent);color:var(--accent-fg);border-color:transparent}
button:disabled{opacity:.5;cursor:default}
#status{color:var(--muted)}
.good{color:var(--good)!important}.bad{color:var(--bad)!important}.warn{color:var(--warn)!important}
.detail{margin:10px 0 0;color:var(--muted);overflow-wrap:anywhere}
:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
`

const SCRIPT = `
(() => {
  "use strict";
  const token = document.querySelector('meta[name="codex-model-filter-token"]').content;
  const $ = (id) => document.getElementById(id);
  const list = $("models"), applyButton = $("apply"), reloadButton = $("reload"), status = $("status"), detail = $("detail");
  let models = [];
  let busy = false;

  // the window this frame is in: its height, and the window's theme
  const post = (message) => { try { parent.postMessage({ magpie: 1, ...message }, "*"); } catch {} };
  let told = -1;
  const size = () => {
    const height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height !== told) { told = height; post({ method: "size", params: { height } }); }
  };
  new ResizeObserver(size).observe(document.documentElement);
  size();
  const paint = (theme) => {
    if (!theme || typeof theme !== "object") return;
    const root = document.documentElement;
    root.dataset.theme = theme.dark ? "dark" : "light";
    root.style.colorScheme = theme.dark ? "dark" : "light";
    for (const [key, value] of Object.entries(theme.tokens || {})) {
      if (/^[a-z0-9-]+$/.test(key) && typeof value === "string") root.style.setProperty("--magpie-" + key, value);
    }
  };
  const THEME_CALL = 7000001;
  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message || message.magpie !== 1) return;
    if (message.event === "theme") paint(message.data);
    else if (message.id === THEME_CALL && message.result) paint(message.result);
  });
  post({ id: THEME_CALL, method: "theme" });

  function say(text, tone) { status.textContent = text; status.className = tone || ""; }
  function explain(text, tone) { detail.textContent = text || ""; detail.className = "detail " + (tone || ""); detail.hidden = !text; }

  async function call(path, init) {
    init = init || {};
    const headers = Object.assign({}, init.headers, { "x-codex-model-filter-token": token });
    const response = await fetch(path, Object.assign({}, init, { headers, cache: "no-store" }));
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok || !body || !body.ok) {
      const error = new Error((body && body.error) || "本地服务返回 " + response.status);
      error.body = body;
      throw error;
    }
    return body;
  }

  const boxes = () => [...list.querySelectorAll("input[type=checkbox]")];

  function render(next) {
    models = Array.isArray(next) ? next : [];
    list.removeAttribute("aria-busy");
    if (!models.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "Codex 账号没有列出模型。";
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...models.map((model) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      const box = document.createElement("input");
      box.type = "checkbox";
      box.value = model.slug;
      box.checked = !!model.hidden;
      box.onchange = changed;
      const name = document.createElement("code");
      name.textContent = model.slug;
      const now = document.createElement("span");
      now.className = "now";
      label.append(box, name, now);
      li.append(label);
      return li;
    }));
    rows();
  }

  // each row's state, and Apply only while the ticks differ from Magpie's
  function rows() {
    let hide = 0, show = 0;
    for (const box of boxes()) {
      const model = models.find((m) => m.slug === box.value);
      const now = box.closest("label").querySelector(".now");
      const differs = !!model && model.hidden !== box.checked;
      if (differs) { if (box.checked) hide++; else show++; }
      now.textContent = differs ? (box.checked ? "将隐藏" : "将显示") : (box.checked ? "已隐藏" : "显示中");
      now.classList.toggle("change", differs);
      box.disabled = busy;
    }
    applyButton.disabled = busy || hide + show === 0;
    reloadButton.disabled = busy;
    return { hide, show };
  }

  function changed() {
    const { hide, show } = rows();
    if (hide + show) say("将隐藏 " + hide + " 个、显示 " + show + " 个，点「应用」生效");
    else say("与 Magpie 当前设置一致");
    explain("");
  }

  function setBusy(on) { busy = on; rows(); }

  async function load() {
    if (busy) return;
    setBusy(true);
    say("正在读取 Codex 模型…");
    explain("");
    try {
      const body = await call("api/state");
      render(body.models);
      setBusy(false);
      if (models.length) say("与 Magpie 当前设置一致");
      else say("Codex 账号没有列出模型", "warn");
    } catch (error) {
      if (error.body && Array.isArray(error.body.models)) render(error.body.models);
      setBusy(false);
      say("读取失败", "bad");
      explain(error.message, "bad");
    }
  }

  async function apply() {
    if (busy) return;
    const hidden = boxes().filter((box) => box.checked).map((box) => box.value);
    setBusy(true);
    say("正在应用…");
    explain("");
    try {
      const body = await call("api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hidden }) });
      render(body.models);
      setBusy(false);
      if (!body.changed) { say("没有改动"); return; }
      const catalog = body.catalog || {};
      if (catalog.status === "verified") {
        say("已应用", "good");
        explain("Codex 的模型目录已同步，重新打开 Codex 的模型选择器即可看到变化。");
      } else if (catalog.status === "stale") {
        const parts = [];
        if (catalog.stillListed && catalog.stillListed.length) parts.push("仍列出 " + catalog.stillListed.join(", "));
        if (catalog.notListed && catalog.notListed.length) parts.push("还缺 " + catalog.notListed.join(", "));
        say("已应用，Codex 目录待同步", "warn");
        explain("Magpie 已保存，但 Codex 的模型目录" + parts.join("，") + "。重启 Magpie 后重新打开 Codex 的模型选择器。", "warn");
      } else if (catalog.status === "missing") {
        say("已应用", "good");
        explain("Magpie 已保存。没找到 Codex 的模型目录文件（" + (catalog.file || "magpie-desktop-models.json") + "），Codex 可能没有接入 Magpie，无法确认 Codex 端的显示。", "warn");
      } else {
        say("已应用", "good");
        explain("Magpie 已保存，但读不了 Codex 的模型目录：" + (catalog.error || "未知错误"), "warn");
      }
    } catch (error) {
      if (error.body && Array.isArray(error.body.models)) render(error.body.models);
      setBusy(false);
      say("应用失败", "bad");
      explain(error.message, "bad");
    }
  }

  applyButton.onclick = apply;
  reloadButton.onclick = load;
  load();
})();
`

export function renderPage({ token, port }) {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Codex 模型过滤</title>
<meta name="codex-model-filter-token" content="${esc(token)}">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src http://127.0.0.1:${Number(port)} http://localhost:${Number(port)}; base-uri 'none'; form-action 'none'">
<style>${CSS}</style>
<p class="lead">勾选的模型不会出现在 Codex 的模型选择器里，改完点「应用」。</p>
<ul id="models" class="models" aria-label="Codex 模型" aria-busy="true"><li class="empty">正在读取 Codex 模型…</li></ul>
<div class="bar">
<button id="apply" class="primary" type="button" disabled>应用</button>
<button id="reload" type="button">刷新</button>
<span id="status" role="status" aria-live="polite"></span>
</div>
<p id="detail" class="detail" hidden></p>
<script>${SCRIPT}</script>
</html>`
}
