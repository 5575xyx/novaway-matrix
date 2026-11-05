;(function () {
  var key = "novaway-theme-id"

  var themeId = localStorage.getItem(key) || "novaway"

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
