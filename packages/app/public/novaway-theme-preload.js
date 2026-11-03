;(function () {
  var key = "novaway-theme-id"

  // 旧版本用 opencode-* 前缀存主题：新键缺失时把旧值搬过来，避免用户丢主题设置；
  // 旧键无论是否搬迁都清掉，别让它一直躺在 localStorage 里。
  var LEGACY = ["theme-id", "theme-css-light", "theme-css-dark", "color-scheme"]
  var hasNew = localStorage.getItem(key) !== null
  for (var i = 0; i < LEGACY.length; i++) {
    var legacyKey = "opencode-" + LEGACY[i]
    var legacyValue = localStorage.getItem(legacyKey)
    if (legacyValue !== null && !hasNew) localStorage.setItem("novaway-" + LEGACY[i], legacyValue)
    localStorage.removeItem(legacyKey)
  }

  var themeId = localStorage.getItem(key) || "novaway"

  if (themeId === "oc-1" || themeId === "oc-2") {
    themeId = "novaway-classic"
    localStorage.setItem(key, themeId)
    localStorage.removeItem("novaway-theme-css-light")
    localStorage.removeItem("novaway-theme-css-dark")
  }

  var scheme = localStorage.getItem("novaway-color-scheme") || "system"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  // Update theme-color meta tag to match app color scheme
  var metas = document.querySelectorAll("meta[name='theme-color']")
  var themeColors = {
    "novaway-classic": { dark: "#131010", light: "#F8F7F7" },
    novaway: { dark: "#1a2332", light: "#f0f9ff" },
  }
  var colors = themeColors[themeId] || { dark: "#131010", light: "#F8F7F7" }
  if (metas.length > 0) metas[0].setAttribute("content", isDark ? colors.dark : colors.light)

  if (themeId === "novaway-classic") return

  var css = localStorage.getItem("novaway-theme-css-" + mode)
  if (css) {
    var style = document.createElement("style")
    style.id = "novaway-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
