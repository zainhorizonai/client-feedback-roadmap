/*
 * SEAM page snippet. Add it to the site your clients test:
 *
 *   <script src="https://YOUR-SEAM-ADDRESS/seam-widget.js" defer></script>
 *
 * It keeps a short, rolling record of console messages, script errors and failed network requests in the page's
 * memory. Nothing is sent anywhere on its own. When someone presses "Report a problem", SEAM opens in a small
 * window and the person's own report gets that record attached, which they can untick before sending.
 *
 * Optional attributes on the script tag:
 *   data-button="off"       hide the floating button; call window.SEAM.open() from your own button instead
 *   data-capture="console"  capture only console (or "network"); the default is both
 *   data-position="left"    put the button bottom left
 */
(function () {
  if (window.SEAM && window.SEAM.__loaded) return
  var script = document.currentScript
  if (!script) return
  var portal
  try { portal = new URL(script.src).origin } catch (e) { return }
  var capture = (script.getAttribute('data-capture') || 'console,network').split(',').map(function (s) { return s.trim() })
  var MAX_LOGS = 100, MAX_NET = 60

  var logs = [], network = []
  var stamp = function () { return new Date().toISOString().slice(11, 19) }
  var push = function (list, item, max) { list.push(item); if (list.length > max) list.shift() }
  // Query strings and fragments often hold tokens, so they are never recorded.
  var clean = function (url) { try { var u = new URL(url, location.href); return u.origin + u.pathname } catch (e) { return String(url).split(/[?#]/)[0] } }
  var text = function (v) {
    if (v instanceof Error) return v.name + ': ' + v.message
    if (typeof v === 'string') return v
    try { return JSON.stringify(v) } catch (e) { return String(v) }
  }

  if (capture.indexOf('console') !== -1) {
    ;['log', 'info', 'warn', 'error', 'debug'].forEach(function (level) {
      var original = console[level]
      console[level] = function () {
        try { push(logs, { t: stamp(), level: level, msg: Array.prototype.map.call(arguments, text).join(' ').slice(0, 400) }, MAX_LOGS) } catch (e) { /* never break the page */ }
        return original.apply(console, arguments)
      }
    })
    window.addEventListener('error', function (e) {
      push(logs, { t: stamp(), level: 'error', msg: ((e.message || 'Script error') + (e.filename ? ' at ' + clean(e.filename) + ':' + e.lineno : '')).slice(0, 400) }, MAX_LOGS)
    })
    window.addEventListener('unhandledrejection', function (e) {
      push(logs, { t: stamp(), level: 'error', msg: ('Unhandled promise rejection: ' + text(e.reason)).slice(0, 400) }, MAX_LOGS)
    })
  }

  if (capture.indexOf('network') !== -1) {
    // Only failures are kept: a status of 400 or more, or a request that never completed (status 0).
    var record = function (method, url, status, started) {
      if (status === 0 || status >= 400) push(network, { t: stamp(), method: method, url: clean(url), status: status, ms: Date.now() - started }, MAX_NET)
    }
    if (window.fetch) {
      var originalFetch = window.fetch
      window.fetch = function (input, init) {
        var started = Date.now()
        var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase()
        var url = typeof input === 'string' ? input : (input && input.url) || String(input)
        return originalFetch.apply(this, arguments).then(
          function (res) { record(method, url, res.status, started); return res },
          function (err) { record(method, url, 0, started); throw err },
        )
      }
    }
    var open = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      var started = Date.now()
      this.addEventListener('loadend', function () { record(String(method).toUpperCase(), url, this.status, started) })
      return open.apply(this, arguments)
    }
  }

  var environment = function () {
    var ua = navigator.userAgent, m
    var browser = (m = /Edg\/(\d+)/.exec(ua)) ? 'Edge ' + m[1] : (m = /OPR\/(\d+)/.exec(ua)) ? 'Opera ' + m[1] : (m = /Chrome\/(\d+)/.exec(ua)) ? 'Chrome ' + m[1] : (m = /Firefox\/(\d+)/.exec(ua)) ? 'Firefox ' + m[1] : (m = /Version\/(\d+).*Safari/.exec(ua)) ? 'Safari ' + m[1] : 'Unknown'
    var os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown'
    var tz = ''
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone } catch (e) { /* ignore */ }
    return {
      browser: browser, os: os, device: /Mobi|Android|iPhone/.test(ua) ? 'Phone' : /iPad|Tablet/.test(ua) ? 'Tablet' : 'Desktop',
      viewport: innerWidth + 'x' + innerHeight, screen: screen.width + 'x' + screen.height, language: navigator.language || '', timezone: tz, pixelRatio: String(devicePixelRatio || 1),
    }
  }
  var payload = function () {
    return { source: 'widget', page: location.origin + location.pathname, env: environment(), logs: logs.slice(), network: network.slice() }
  }

  var popup = null
  // The report window says it is ready; only then (and only to SEAM's own address) is anything handed over.
  window.addEventListener('message', function (e) {
    if (!popup || e.source !== popup || e.origin !== portal || !e.data || e.data.type !== 'seam:ready') return
    popup.postMessage({ type: 'seam:context', payload: payload() }, portal)
  })

  function openReport() {
    var w = 720, h = Math.min(900, screen.height - 80)
    popup = window.open(portal + '/reports/new?from=widget', 'seam-report', 'popup=yes,width=' + w + ',height=' + h + ',left=' + Math.max(0, (screen.width - w) / 2) + ',top=40')
    if (popup) popup.focus()
    else window.open(portal + '/reports/new', '_blank')
  }

  window.SEAM = { __loaded: true, open: openReport }

  if (script.getAttribute('data-button') !== 'off') {
    var add = function () {
      var host = document.createElement('div')
      host.setAttribute('data-seam-widget', '')
      var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
      var left = script.getAttribute('data-position') === 'left'
      root.innerHTML = '<style>button{all:initial;box-sizing:border-box;position:fixed;bottom:16px;' + (left ? 'left' : 'right') + ':16px;z-index:2147483000;background:#172e26;color:#f6f2e9;font:600 14px/1 system-ui,sans-serif;padding:12px 16px;border-radius:999px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}button:hover{background:#0f2019}button:focus-visible{outline:3px solid #a3402c;outline-offset:2px}</style><button type="button" aria-label="Report a problem with this page">Report a problem</button>'
      root.querySelector('button').addEventListener('click', openReport)
      document.body.appendChild(host)
    }
    if (document.body) add(); else document.addEventListener('DOMContentLoaded', add)
  }
})()
