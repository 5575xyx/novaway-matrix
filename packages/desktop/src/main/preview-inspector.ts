// 注入本地 HTML 预览的元素选取脚本。
//
// 单独通过 oc-file 协议下发（而不是内联进文档）：内联 <script> 会被页面自带的
// Content-Security-Policy 拦掉，同源的 <script src> 不会。
// 脚本必须保持纯 ASCII —— 注入是按字节拼接的，任何多字节字符都会污染
// GBK/GB2312 这类非 UTF-8 编码的 HTML。
// 用 String.raw 保留正则里的反斜杠：普通模板字符串会把 \s 塌成 s。
// 提示文案由父页面随 ARM 消息下发，脚本本身不含任何自然语言。

export const INSPECTOR_PATH = "/__nova_inspector.js"

export const INSPECTOR_SOURCE = String.raw`(function () {
  if (window.__novaInspector) return
  window.__novaInspector = true

  var READY = '__nova_pick_ready'
  var ELEMENT = '__nova_pick_element'
  var ARM = '__nova_pick_arm'

  var STYLE_KEYS = [
    'color', 'background-color', 'font-family', 'font-size', 'font-weight',
    'line-height', 'text-align', 'padding', 'margin', 'display',
    'width', 'height', 'max-width', 'border-radius', 'border', 'opacity'
  ]

  var armed = false
  var box = null
  var tagLabel = null
  var hint = null

  function send(message) {
    try {
      window.parent.postMessage(message, '*')
    } catch (error) {
      // 预览被 window.open 弹出时 parent 取不到，忽略即可
    }
  }

  function buildOverlay() {
    if (box) return
    box = document.createElement('div')
    box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
      'border:2px solid #6366f1;background:rgba(99,102,241,0.12);box-sizing:border-box'
    tagLabel = document.createElement('div')
    tagLabel.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;' +
      'background:#4f46e5;color:#fff;padding:2px 8px;border-radius:4px;max-width:340px;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'font:12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
    hint = document.createElement('div')
    hint.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);' +
      'z-index:2147483647;pointer-events:none;display:none;background:rgba(17,24,39,0.92);' +
      'color:#fff;padding:6px 14px;border-radius:999px;max-width:80%;' +
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
      'font:12px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'
    document.documentElement.appendChild(box)
    document.documentElement.appendChild(tagLabel)
    document.documentElement.appendChild(hint)
  }

  function hideHighlight() {
    if (box) box.style.display = 'none'
    if (tagLabel) tagLabel.style.display = 'none'
  }

  function labelOf(element) {
    var text = element.tagName.toLowerCase()
    var id = element.getAttribute('id')
    if (id) return text + '#' + id
    var classes = element.getAttribute('class')
    if (classes && typeof classes === 'string') {
      var first = classes.trim().split(/\s+/)[0]
      if (first) return text + '.' + first
    }
    return text
  }

  function highlight(element) {
    buildOverlay()
    var rect = element.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = rect.left + 'px'
    box.style.top = rect.top + 'px'
    box.style.width = rect.width + 'px'
    box.style.height = rect.height + 'px'
    tagLabel.style.display = 'block'
    tagLabel.style.left = rect.left + 'px'
    tagLabel.style.top = Math.max(0, rect.top - 22) + 'px'
    tagLabel.textContent = labelOf(element)
  }

  function pathOf(element) {
    var parts = []
    var node = element
    while (node && node.nodeType === 1) {
      var name = node.tagName.toLowerCase()
      if (name === 'html') break
      var id = node.getAttribute('id')
      if (id) {
        parts.unshift(name + '#' + id)
        break
      }
      var selector = name
      var parent = node.parentElement
      if (parent) {
        var count = 0
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === node.tagName) count++
        }
        if (count > 1) {
          var position = 0
          for (var j = 0; j < parent.children.length; j++) {
            if (parent.children[j].tagName !== node.tagName) continue
            position++
            if (parent.children[j] === node) break
          }
          selector += ':nth-of-type(' + position + ')'
        }
      }
      parts.unshift(selector)
      node = parent
    }
    return parts.join(' > ')
  }

  function attributeMap(element) {
    var out = {}
    for (var i = 0; i < element.attributes.length; i++) {
      var name = element.attributes[i].name
      // on* 事件属性没有诊断价值，还可能夹带用户数据
      if (name.length > 1 && name.charAt(0) === 'o' && name.charAt(1) === 'n') continue
      out[name] = element.attributes[i].value
    }
    return out
  }

  function styleMap(element) {
    var computed = window.getComputedStyle(element)
    var out = {}
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      var key = STYLE_KEYS[i]
      var value = computed.getPropertyValue(key)
      if (value) out[key] = value
    }
    return out
  }

  function pick(element) {
    var rect = element.getBoundingClientRect()
    var text = element.innerText || element.textContent || ''
    send({
      type: ELEMENT,
      sourceUrl: window.location.href,
      element: {
        tag: element.tagName.toLowerCase(),
        cssPath: pathOf(element),
        text: text.replace(/\s+/g, ' ').trim(),
        outerHtml: element.outerHTML,
        attributes: attributeMap(element),
        styles: styleMap(element),
        rect: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }
    })
    setArmed(false, '')
  }

  function setArmed(next, message) {
    armed = next
    buildOverlay()
    if (hint) {
      hint.textContent = message || ''
      hint.style.display = next ? 'block' : 'none'
    }
    document.documentElement.style.cursor = next ? 'crosshair' : ''
    if (!next) hideHighlight()
    send({ type: ARM, sourceUrl: window.location.href, armed: next })
  }

  function onMove(event) {
    if (!armed) return
    var target = event.target
    // overlay 自身 pointer-events:none，不会成为 target，无需额外排除
    if (!target || target.nodeType !== 1) {
      hideHighlight()
      return
    }
    highlight(target)
  }

  function onDown(event) {
    if (!armed) return
    var target = event.target
    if (!target || target.nodeType !== 1) return
    // 捕获阶段拦截，页面自己的 handler 不会执行
    event.preventDefault()
    event.stopPropagation()
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
    pick(target)
  }

  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setArmed(false, '')
  }, true)

  window.addEventListener('message', function (event) {
    var data = event.data
    if (!data || typeof data !== 'object') return
    if (data.type === ARM) setArmed(!!data.armed, typeof data.hint === 'string' ? data.hint : '')
  })

  function announce() {
    send({ type: READY, sourceUrl: window.location.href })
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce, { once: true })
  } else {
    announce()
  }
})()
`
