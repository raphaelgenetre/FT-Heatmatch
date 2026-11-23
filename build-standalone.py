#!/usr/bin/env python3
"""Builds HeatMatch.html: a single file that runs entirely in the browser (no Node needed)."""
import base64, os, re
R = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(R, p), encoding='utf-8').read()
js = lambda t: t.replace('</script', '<\\/script')

data_js = rd('lib/data.js')
srv = rd('server.js')
core = srv[srv.index('const STATUSES'):srv.index('http.createServer')]
core = core.replace("const BASE_SITES = D.generateSites();", "const BASE_SITES = D.generateSites();")
# swap file persistence for localStorage
core = re.sub(r"function save\(\) \{.*?\n", "function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }\n", core, count=1)
core = re.sub(r"function load\(\) \{.*?\n\}\n", "function load() { try { state = JSON.parse(localStorage.getItem(KEY)); } catch (e) {} if (!state || !state.leads) seed(); }\n", core, count=1, flags=re.S)
core = re.sub(r"function send\(res.*?\n", "function send(res, code, obj) { res.code = code; res.data = obj; }\n", core, count=1)
core = re.sub(r"function body\(req\).*?\n", "function body(req) { return Promise.resolve(req.body || {}); }\n", core, count=1)
core = re.sub(r"const MIME = .*?\n", "", core, count=1)

bundle = f"""(function(){{
const module = {{ exports: {{}} }};
(function(module){{ {data_js} }})(module);
const D = module.exports;
const KEY = 'ft-heatmatch-state-v1';
{core}
window.LOCAL_API = async function(path, method, payload) {{
  const url = new URL('/api' + path, 'http://local');
  const res = {{ code: 200, data: null }};
  await api({{ method, body: payload }}, res, url);
  return res;
}};
}})();"""

html = rd('public/index.html')
logo = 'data:image/png;base64,' + base64.b64encode(open(os.path.join(R, 'public/ft-logo.png'), 'rb').read()).decode()
html = html.replace('/ft-logo.png', logo)
html = html.replace('<link rel="stylesheet" href="/vendor/leaflet.css">', '<style>' + rd('public/vendor/leaflet.css') + '</style>')
html = html.replace('<link rel="stylesheet" href="/theme.css">', '<style>' + rd('public/theme.css') + '</style>')
html = html.replace('<link rel="stylesheet" href="/app.css">', '<style>' + rd('public/app.css') + '</style>')
html = html.replace('<script src="/vendor/leaflet.js"></script>', '<script>' + js(rd('public/vendor/leaflet.js')) + '</script>')
html = html.replace('<script src="/vendor/world.js"></script>', '<script>' + js(rd('public/vendor/world.js')) + '</script>\n  <script>' + js(bundle) + '</script>')
html = html.replace('<script src="/app.js"></script>', '<script>' + js(rd('public/app.js')) + '</script>')
assert 'src="/' not in html and 'href="/' not in html, 'unresolved asset'
open(os.path.join(R, 'HeatMatch.html'), 'w', encoding='utf-8').write(html)
print('Wrote HeatMatch.html', round(len(html) / 1e6, 2), 'MB')
