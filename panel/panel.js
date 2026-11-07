// Magpie serves this panel in Settings > Plugins, in a frame that can't
// reach the network (connect-src 'none'). The model list is the plugin's
// local service page, so the frame goes there once the panel is in view:
// Magpie draws the panel when the window starts, Settings closed or not,
// and the list asks the Magpie CLI each time it loads.
(() => {
  "use strict"
  const state = document.getElementById("state")
  const say = (text) => { state.textContent = text }
  if (!window.magpie) {
    say("没有连上 Magpie 的页面桥接，重新打开设置试试。")
    return
  }

  let opened = false
  async function open() {
    if (opened) return
    opened = true
    let port = 3477
    try {
      const options = await magpie.options.get()
      const wanted = Number(options?.port)
      if (Number.isInteger(wanted) && wanted >= 1024 && wanted <= 65535) port = wanted
    } catch {
      // the default port, as the service uses with no options
    }
    location.replace(`http://127.0.0.1:${port}/`)
  }

  magpie.ready.then(() => {
    if (!("IntersectionObserver" in window)) return open()
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      seen.disconnect()
      open()
    })
    seen.observe(state)
  }, () => say("Magpie 没有回应这个面板，重新打开设置试试。"))
})()
