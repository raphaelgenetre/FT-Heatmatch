/* FT HeatMatch — front-end (vanilla JS, hash router) */
(() => {
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n0 = v => Math.round(v).toLocaleString('en-GB');
const n1 = v => (+v).toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const eur = v => '€' + (v >= 1e6 ? n1(v / 1e6) + 'M' : v >= 1e3 ? n0(v / 1e3) + 'k' : n0(v));
const pct = v => v == null ? '—' : Math.round(v * 100) + '%';
const date = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const ago = t => { const d = (Date.now() - t) / 864e5; return d < 1 ? 'today' : d < 2 ? 'yesterday' : d < 31 ? `${Math.floor(d)} days ago` : date(t); };
// distances: metres under 1 km
const dist = km => km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${n1(km)} km`;
// environmental impact of `mwh` of recovered heat (same formula as lib/data.js, constants from the server)
function impactOf(mwh) {
  const E = META.econ, gas = mwh / E.boilerEfficiency, co2 = gas * E.co2PerMWh;
  return { heatMWh: mwh, gasM3: gas * 1000 / E.kWhPerM3Gas, co2Tonnes: co2, homes: mwh / E.homeHeatMWh, cars: co2 / E.carCO2t, savingsEur: mwh * E.heatPrice };
}
const big = v => v >= 1e6 ? n1(v / 1e6) + ' million' : n0(v);
function impactMethod() {
  const E = META.econ;
  return `Recovered cremator heat replaces heat from gas boilers. 1 MWh of heat saves ${(1 / E.boilerEfficiency).toFixed(2)} MWh of gas (boiler efficiency ${Math.round(E.boilerEfficiency * 100)}%), and burning gas emits ${E.co2PerMWh} t CO₂ per MWh. A home uses about ${E.homeHeatMWh} MWh of heat a year; a car emits about ${E.carCO2t} t CO₂ a year. Heat valued at €${E.heatPrice}/MWh.`;
}
const slug = s => s.toLowerCase().replace(/[^a-z]+/g, '-');
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

class AuthError extends Error { constructor() { super('Please sign in'); this.auth = true; } }
let SESSION = null; // signed-in email

async function api(path, opts = {}) {
  if (window.LOCAL_API) { // standalone (no-server) build
    const r = await window.LOCAL_API(path, opts.method || 'GET', opts.body ? JSON.parse(JSON.stringify(opts.body)) : undefined);
    if (r.code === 401 && r.data.auth) { showLogin(); throw new AuthError(); }
    if (r.code >= 400) throw new Error(r.data.error || 'Request failed');
    return JSON.parse(JSON.stringify(r.data));
  }
  const res = await fetch('/api' + path, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json();
  if (res.status === 401 && data.auth) { showLogin(); throw new AuthError(); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2800); }

const statusBadge = s => `<span class="badge s-${slug(s)}">${esc(s)}</span>`;
const siteBadge = s => s === 'partnership' ? '<span class="badge partnership">Partnership</span>' : s === 'progress' ? '<span class="badge progress">In progress</span>' : '<span class="badge">No partnership yet</span>';
const scoreColor = v => v >= 70 ? css('--heat-600') : v >= 50 ? '#f6c48f' : '#c3ccd8';
const scoreWord = v => v >= 70 ? 'Strong' : v >= 50 ? 'Good' : 'Weak';
const scoreBar = v => `<div class="score"><b>${v}</b><div class="bar"><i style="width:${v}%;background:${scoreColor(v)}"></i></div><span class="sw sw-${scoreWord(v).toLowerCase()}">${scoreWord(v)}</span></div>`;
// small "?" help bubble (hover or keyboard focus)
const tip = text => `<span class="tip" tabindex="0" role="note" aria-label="${esc(text)}" data-tip="${esc(text)}">?</span>`;
const lsGet = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

let META = null;
let maps = [];
function destroyMaps() { maps.forEach(m => m.remove()); maps = []; }

function baseMap(el, opts = {}) {
  const map = L.map(el, { zoomControl: true, attributionControl: true, preferCanvas: true, worldCopyJump: true, ...opts });
  // Offline fallback outline so the map still renders without internet
  // (kept in its own pane BELOW the tile layers, so online tiles always cover it)
  map.createPane('fallback').style.zIndex = 150;
  L.geoJSON(window.WORLD_GEO, { pane: 'fallback', renderer: L.svg({ pane: 'fallback' }), style: { color: '#c6d0dc', weight: 0.8, fillColor: '#ffffff', fillOpacity: 1 }, interactive: false }).addTo(map);
  const styles = {
    // Esri Light Gray Canvas (no API key needed, works when opened as a local file)
    map: [
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Map &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors', maxNativeZoom: 16, maxZoom: 19 }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 19 }),
    ],
    satellite: [
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics', maxZoom: 19 }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
    ],
  };
  const apply = style => {
    Object.values(styles).flat().forEach(l => map.hasLayer(l) && map.removeLayer(l));
    styles[style].forEach(l => l.addTo(map));
    el.classList.toggle('is-satellite', style === 'satellite');
    $$('.map-style button', el).forEach(b => b.classList.toggle('on', b.dataset.style === style));
  };
  const Switch = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      const d = L.DomUtil.create('div', 'map-style');
      d.innerHTML = '<button type="button" data-style="map">Map</button><button type="button" data-style="satellite">Satellite</button>';
      L.DomEvent.disableClickPropagation(d);
      d.onclick = e => { const s = e.target.dataset.style; if (!s) return; mapStyle = s; try { localStorage.setItem('hm-map-style', s); } catch (_) {} apply(s); };
      return d;
    },
  });
  map.addControl(new Switch());
  apply(mapStyle);
  maps.push(map);
  return map;
}
let mapStyle = (() => { try { return localStorage.getItem('hm-map-style') === 'satellite' ? 'satellite' : 'map'; } catch (_) { return 'map'; } })();

// ======================= OVERVIEW =======================
async function viewOverview(app) {
  const [st, sites] = await Promise.all([api('/stats'), api('/sites')]);
  const t = st.totals;
  const maxPipe = Math.max(...st.pipeline.map(p => p.count), 1);
  const sectors = st.sectors.filter(s => s.leads).sort((a, b) => (b.conversion ?? -1) - (a.conversion ?? -1));
  const maxSectorLeads = Math.max(...sectors.map(s => s.leads), 1);
  const pipeColor = { 'Contacted': '#8a9095', 'In discussion': css('--warn-600'), 'Feasibility study': '#e0a63a', 'Contract signed': css('--ok-600'), 'Declined': css('--bad-600') };

  const welcome = lsGet('hm-welcome-hidden') ? '' : `
  <div class="card welcome" id="welcome">
    <div class="welcome-head"><div><h2>Welcome to HeatMatch 👋</h2><p class="muted">Turn the waste heat of FT cremators into heat partnerships, in three steps.</p></div>
      <button class="x" id="hideWelcome" title="Hide this guide" aria-label="Hide this guide">×</button></div>
    <ol class="steps">
      <li><span class="step-n">1</span><div><b>Pick a crematorium</b><p>Search below or click a dot on the map.</p></div></li>
      <li><span class="step-n">2</span><div><b>See who could use its heat</b><p>Nearby businesses are ranked from strong to weak matches, with the reasons why.</p></div></li>
      <li><span class="step-n">3</span><div><b>Contact them and track deals</b><p>Send a personalised email, then follow each deal in the pipeline.</p></div></li>
    </ol>
  </div>`;
  app.innerHTML = `
  <div class="page-head">
    <div><h1>Global overview</h1><p>Surplus heat from FT cremators worldwide and the partnerships built on it.</p></div>
    <a class="btn primary" href="#/installations">Start matching →</a>
  </div>
  ${welcome}
  <div class="card quick-search">
    <label for="qs" class="qs-label">Find a crematorium</label>
    <div class="qs-box"><span class="qs-icon" aria-hidden="true">⌕</span><input type="text" id="qs" placeholder="Type a city or crematorium name, e.g. London, Rotterdam…" autocomplete="off"></div>
    <div class="qs-results" id="qsRes" hidden></div>
  </div>
  <div class="grid kpis">
    <div class="card kpi"><div class="label">Cremators ${tip('Individual FT cremator units. A crematorium site can have one or more.')}</div><div class="value">${n0(t.units)}</div><div class="sub">${n0(t.sites)} sites · ${t.countries} countries · ${pct(t.europeUnits / t.units)} in Europe</div></div>
    <div class="card kpi accent"><div class="label">Recoverable heat ${tip('Waste heat the cremators could supply each year. 1 GWh = 1,000 MWh, roughly the yearly heating of 70 homes.')}</div><div class="value">${n0(t.supplyGWh)}<small>GWh/yr</small></div><div class="sub">Surplus heat across the installed base</div></div>
    <div class="card kpi"><div class="label">Signed partnerships ${tip('Businesses that signed a contract to buy heat from a crematorium.')}</div><div class="value">${n0(t.partnerships)}</div><div class="sub">${t.sitesWithPartnership} sites · ${pct(t.sitesWithPartnership / t.sites)} of the network</div></div>
    <div class="card kpi"><div class="label">Heat delivered ${tip('Heat supplied each year through signed partnerships, replacing mostly gas heating.')}</div><div class="value">${n1(t.deliveredGWh)}<small>GWh/yr</small></div><div class="sub">${n0(t.co2Tonnes)} t CO₂ avoided per year</div></div>
    <div class="card kpi"><div class="label">Active pipeline ${tip('Deals in progress: contacted, in discussion or in a feasibility study.')}</div><div class="value">${n0(t.activeLeads)}</div><div class="sub">${t.sitesInProgress} sites in progress · ${n0(t.emailsSent)} emails sent</div></div>
  </div>
  <div class="card impact-card">
    <div class="card-head"><div><h2>🌱 Environmental impact</h2><div class="muted" style="font-size:12.5px">Gas boilers replaced by recovered cremator heat, per year</div></div>${tip(impactMethod())}</div>
    <div class="impact-cols">
      ${[['Today', 'from signed partnerships', st.impact.signed, 'now'],
         ['If the pipeline signs', 'deals in progress, added on top', st.impact.pipeline, 'next'],
         ['Full potential', `if all heat from FT's ${n0(t.units)} cremators is used`, st.impact.potential, 'max']].map(([title, sub, im, cls]) => `
      <div class="impact-col ${cls}">
        <div class="impact-title">${title}</div><div class="muted" style="font-size:12px">${sub}</div>
        <div class="impact-big"><b>${big(im.co2Tonnes)}</b> t CO₂ avoided</div>
        <div class="impact-heat">${n1(im.heatMWh / 1000)} GWh of heat recovered</div>
        <ul class="impact-eq">
          <li><span>🏠</span><b>${big(im.homes)}</b> homes heated</li>
          <li><span>🚗</span><b>${big(im.cars)}</b> cars off the road</li>
          <li><span>🔥</span><b>${big(im.gasM3)}</b> m³ of gas saved</li>
          <li><span>💶</span><b>${eur(im.savingsEur)}</b> heating costs saved</li>
        </ul>
      </div>`).join('')}
    </div>
  </div>
  <div class="grid two">
    <div class="card">
      <div class="card-head"><h2>Global partnership map</h2>
        <div class="legend"><span><i style="background:${css('--ok-600')}"></i>Partnership</span><span><i style="background:${css('--ft-orange')}"></i>In progress</span><span><i style="background:#b4b8bb"></i>No partnership yet</span></div></div>
      <div id="gmap" class="map tall"></div>
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="card-head"><h2>Partnership pipeline</h2><a href="#/pipeline">Open →</a></div>
        <div class="card-pad funnel">${st.pipeline.map(p => `<div class="hbar"><span>${esc(p.status)}</span><div class="track"><i style="width:${p.count / maxPipe * 100}%;background:${pipeColor[p.status]}"></i></div><span class="v">${p.count}</span></div>`).join('')}</div></div>
      <div class="card"><div class="card-head"><h2>Recent activity</h2></div>
        <ul class="feed">${st.activity.slice(0, 7).map(a => `<li><span><a href="#/site/${a.siteId}">${esc(a.siteName)}</a><br><span class="muted">${esc(a.text)}</span></span><span class="muted" style="white-space:nowrap">${ago(a.at)}</span></li>`).join('') || '<li class="muted">No activity yet</li>'}</ul></div>
    </div>
  </div>

  <h3 class="section-title" style="margin-top:28px">Partnership patterns</h3>
  <div class="grid halves">
    <div class="card"><div class="card-head"><h2>Which sectors sign?</h2><span class="muted" style="font-size:12px">Bar = leads · dark = signed</span></div>
      <div class="card-pad">${sectors.map(s => `<div class="hbar" title="${s.signed} signed of ${s.leads} leads"><span>${esc(s.label)}</span>
        <div class="track"><i style="width:${s.signed / maxSectorLeads * 100}%;background:${css('--ok-600')}"></i><i style="width:${(s.leads - s.signed) / maxSectorLeads * 100}%;background:${css('--brand-100')}"></i></div>
        <span class="v">${pct(s.conversion)} win</span></div>`).join('')}</div></div>
    <div class="card"><div class="card-head"><h2>Win rate by distance</h2><span class="muted" style="font-size:12px">Signed ÷ (signed + declined)</span></div>
      <div class="card-pad">${st.distanceBands.map(b => `<div class="hbar"><span>${b.label}<br><span class="muted" style="font-size:12px">${b.leads} leads</span></span><div class="track"><i style="width:${(b.conversion || 0) * 100}%;background:${css('--ft-orange')}"></i></div><span class="v">${pct(b.conversion)}</span></div>`).join('')}
      <p class="muted" style="font-size:12.5px;margin:14px 0 0">Shorter pipe runs win more often: lower capex and faster payback.</p></div></div>
    <div class="card"><div class="card-head"><h2>Coverage by country</h2></div>
      <div class="table-wrap" style="max-height:360px"><table><thead><tr><th>Country</th><th class="r">Cremators</th><th class="r">Signed</th><th class="r">Active</th></tr></thead>
      <tbody>${st.countries.slice(0, 14).map(c => `<tr><td>${esc(c.name)}</td><td class="r num">${c.units}</td><td class="r num">${c.partnerships}</td><td class="r num">${c.inProgress}</td></tr>`).join('')}</tbody></table></div></div>
  </div>`;

  // welcome guide + quick search
  const hw = $('#hideWelcome'); if (hw) hw.onclick = () => { lsSet('hm-welcome-hidden', '1'); $('#welcome').remove(); };
  const qs = $('#qs'), qr = $('#qsRes');
  const showResults = () => {
    const q = qs.value.trim().toLowerCase();
    if (!q) { qr.hidden = true; return; }
    const hits = sites.filter(s => (s.name + ' ' + s.city + ' ' + s.countryName).toLowerCase().includes(q)).sort((a, b) => b.supplyMWh - a.supplyMWh).slice(0, 6);
    qr.innerHTML = hits.map(s => `<a class="qs-item" href="#/site/${s.id}"><span><b>${esc(s.name)}</b><br><span class="muted">${esc(s.city)}, ${esc(s.countryName)} · ${s.units} cremator${s.units > 1 ? 's' : ''}</span></span>${siteBadge(s.status)}</a>`).join('')
      || `<div class="qs-empty">No crematorium matches “${esc(qs.value)}”. Try a city name.</div>`;
    qr.hidden = false;
  };
  qs.oninput = showResults;
  qs.onkeydown = e => { if (e.key === 'Enter') { const a = $('.qs-item', qr); if (a) location.hash = a.getAttribute('href'); } };

  const map = baseMap($('#gmap')).setView([51.5, 6], 4);
  const col = { partnership: css('--ok-600'), progress: css('--ft-orange'), none: '#b4b8bb' };
  const order = { none: 0, progress: 1, partnership: 2 };
  sites.slice().sort((a, b) => order[a.status] - order[b.status]).forEach(s => {
    L.circleMarker([s.lat, s.lon], { radius: s.status === 'none' ? 4 : 6, color: '#fff', weight: 1, fillColor: col[s.status], fillOpacity: .9 })
      .bindPopup(`<h4>${esc(s.name)}</h4><div class="muted">${esc(s.city)}, ${esc(s.countryName)}</div>
        <div style="margin:8px 0">${s.units} × ${esc(s.model)} · ${n0(s.supplyMWh)} MWh/yr surplus<br>${s.leads} leads · ${s.signed} signed</div>
        <a class="btn sm primary" href="#/site/${s.id}">Find heat users →</a>`).addTo(map);
  });
}

// ======================= INSTALLATIONS =======================
const instState = { q: '', country: '', status: '', page: 0, sort: 'supplyMWh' };
async function viewInstallations(app) {
  const sites = await api('/sites');
  const countries = [...new Map(sites.map(s => [s.country, s.countryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  app.innerHTML = `
  <div class="page-head"><div><h1>Installations</h1><p>${n0(sites.reduce((a, s) => a + s.units, 0))} FT cremators at ${sites.length} sites. <b>Click a crematorium</b> to find businesses nearby that could use its heat.</p></div></div>
  <div class="card">
    <div class="card-head"><div class="toolbar">
      <input type="text" id="q" placeholder="Search a city or crematorium…" value="${esc(instState.q)}">
      <select id="country"><option value="">All countries</option>${countries.map(([c, n]) => `<option value="${c}" ${instState.country === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <select id="status"><option value="">Any status</option><option value="none">No partnership yet</option><option value="progress">In progress</option><option value="partnership">Partnership</option></select>
      <select id="sort"><option value="supplyMWh">Sort: surplus heat</option><option value="name">Sort: name</option><option value="leads">Sort: leads</option></select>
    </div><span class="muted" id="count"></span></div>
    <div class="table-wrap"><table><thead><tr><th>Crematorium</th><th>Location</th><th class="r">Cremators</th><th class="r">Waste heat / year</th><th>Partnership status</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="pager"><span id="pinfo"></span><span><button class="btn sm" id="prev">← Prev</button> <button class="btn sm" id="next">Next →</button></span></div>
  </div>`;
  $('#status').value = instState.status; $('#sort').value = instState.sort;
  const PER = 25;
  function render() {
    const q = instState.q.toLowerCase();
    let list = sites.filter(s => (!q || (s.name + s.city + s.id).toLowerCase().includes(q)) && (!instState.country || s.country === instState.country) && (!instState.status || s.status === instState.status));
    list.sort((a, b) => instState.sort === 'name' ? a.name.localeCompare(b.name) : b[instState.sort] - a[instState.sort]);
    const pages = Math.max(1, Math.ceil(list.length / PER));
    instState.page = Math.min(instState.page, pages - 1);
    $('#count').textContent = `${list.length} crematori${list.length === 1 ? 'um' : 'a'}`;
    $('#rows').innerHTML = list.slice(instState.page * PER, (instState.page + 1) * PER).map(s => `
      <tr class="clickable" data-id="${s.id}"><td><b>${esc(s.name)}</b><div class="muted" style="font-size:12px">${esc(s.model)} · ${s.id}</div></td><td>${esc(s.city)}, ${esc(s.countryName)}</td>
      <td class="r num">${s.units}</td><td class="r num">${n0(s.supplyMWh)} MWh</td><td>${siteBadge(s.status)}${s.leads ? ` <span class="muted" style="font-size:12px">${s.leads} lead${s.leads > 1 ? 's' : ''}</span>` : ''}</td><td class="r"><span class="open-link">Find heat users →</span></td></tr>`).join('') || `<tr><td colspan="6" class="empty">No crematorium matches these filters.<br><button class="btn sm" id="clearF" style="margin-top:10px">Clear filters</button></td></tr>`;
    const cf = $('#clearF'); if (cf) cf.onclick = () => { Object.assign(instState, { q: '', country: '', status: '', page: 0 }); $('#q').value = ''; $('#country').value = ''; $('#status').value = ''; render(); };
    $('#pinfo').textContent = `Page ${instState.page + 1} of ${pages}`;
    $('#prev').disabled = instState.page === 0; $('#next').disabled = instState.page >= pages - 1;
  }
  $('#q').oninput = e => { instState.q = e.target.value; instState.page = 0; render(); };
  $('#country').onchange = e => { instState.country = e.target.value; instState.page = 0; render(); };
  $('#status').onchange = e => { instState.status = e.target.value; instState.page = 0; render(); };
  $('#sort').onchange = e => { instState.sort = e.target.value; render(); };
  $('#prev').onclick = () => { instState.page--; render(); };
  $('#next').onclick = () => { instState.page++; render(); };
  $('#rows').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/site/' + tr.dataset.id; };
  render();
}

// ======================= SITE / MATCHING =======================
const matchState = { radius: 0.5, we: 40, wl: 30, wf: 30, preset: 'balanced', sector: '', minScore: 0, hideContacted: false, view: 'map' };
const PRESETS = {
  balanced:   { label: 'Balanced',            help: 'A mix of everything',               w: [40, 30, 30] },
  demand:     { label: 'Biggest heat users',  help: 'Who can use the most heat',         w: [70, 15, 15] },
  likely:     { label: 'Most likely to sign', help: 'Who is most open to a contract',    w: [15, 70, 15] },
  cheap:      { label: 'Cheapest to connect', help: 'Short pipes, fast payback',         w: [15, 15, 70] },
};
// Plain-language reasons shown under each company
function reasons(u, site) {
  const good = [], warn = [];
  if (u.distanceKm <= 0.3) good.push(`Only ${dist(u.distanceKm)} away`);
  if (u.score.paybackYears <= 8) good.push(`Pays back in ${n1(u.score.paybackYears)} yrs`);
  if (u.publicSector) good.push('Public sector');
  if (u.profileFit >= 0.85) good.push('Needs heat when cremators run');
  if (u.sustainability.startsWith('Certified')) good.push('Certified sustainable');
  else if (u.sustainability.startsWith('Net-zero')) good.push('Net-zero goal');
  if (u.heatingSystemAge >= 15) good.push(`Old boiler (${u.heatingSystemAge} yrs)`);
  if (u.annualDemandMWh >= site.supplyMWh) good.push('Could take all our heat');
  if (u.score.tempGap < 0) warn.push('Needs hotter water than we supply');
  if (u.score.paybackYears > 25) warn.push('Long payback');
  if (u.distanceKm >= 0.8) warn.push('At the edge of the 1 km range');
  return good.slice(0, 3).map(t => `<span class="why ok">✓ ${esc(t)}</span>`).join('') + warn.slice(0, 2).map(t => `<span class="why warn">! ${esc(t)}</span>`).join('');
}
async function viewSite(app, id) {
  const selected = new Set();
  let data, site, map, layer, circle;

  async function loadSite() { site = await api('/sites/' + id); }
  await loadSite();

  app.innerHTML = `
  <div class="crumb"><a href="#/installations">← All crematoria</a></div>
  <div class="page-head">
    <div><h1>${esc(site.name)}</h1><p>${esc(site.city)}, ${esc(site.countryName)} · ${esc(site.operator)} · ${siteBadge(site.status)}</p></div>
    <div class="toolbar"><button class="btn" id="editBtn" title="Enter the latest figures from this site">✎ Update site data</button></div>
  </div>
  <div class="card facts" id="facts"></div>
  <div class="grid match-layout">
    <div class="card controls">
      <section>
        <h3 class="ctl-title"><span class="step-n sm">1</span>Where to look</h3>
        <div class="ctl-row"><span>Search radius ${tip('Why 500 m? Insulated hot-water pipes cost about €900 per metre to lay and lose heat along the way. Within about 500 m a connection usually pays back in under 10 years; beyond 1 km it rarely pays back, so 1 km is the maximum.')}</span><output id="rOut"></output></div>
        <input type="range" id="radius" min="0.1" max="1" step="0.05" value="${matchState.radius}" aria-label="Search radius">
        <div class="pills" id="rPills">${[0.25, 0.5, 0.75, 1].map(k => `<button type="button" data-r="${k}">${k === 0.5 ? '★ ' : ''}${dist(k)}</button>`).join('')}</div>
        <div class="ctl-help" style="margin-top:6px">★ 500 m is the recommended radius. 1 km is the maximum.</div>
      </section>
      <section>
        <h3 class="ctl-title"><span class="step-n sm">2</span>What matters most? ${tip('Changes how companies are ranked. Each company gets a score from 0 to 100.')}</h3>
        <div class="presets" id="presets">${Object.entries(PRESETS).map(([k, p]) => `<button type="button" data-p="${k}"><b>${p.label}</b><span>${p.help}</span></button>`).join('')}</div>
        <details class="advanced" id="adv">
          <summary>Customise the weights</summary>
          <div class="ctl-row"><span>Heat demand fit</span><output id="weOut"></output></div>
          <input type="range" id="we" min="0" max="100" value="${matchState.we}">
          <div class="ctl-help">How much heat they need, and whether they need it when the cremators run.</div>
          <div class="ctl-row"><span>Chance of signing</span><output id="wlOut"></output></div>
          <input type="range" id="wl" min="0" max="100" value="${matchState.wl}">
          <div class="ctl-help">Sector, public sector, sustainability goals, age of their boiler.</div>
          <div class="ctl-row"><span>Cost to connect</span><output id="wfOut"></output></div>
          <input type="range" id="wf" min="0" max="100" value="${matchState.wf}">
          <div class="ctl-help">Pipe length, water temperature, payback time.</div>
        </details>
      </section>
      <section>
        <h3 class="ctl-title"><span class="step-n sm">3</span>Filter</h3>
        <label class="field">Type of business<select id="sector"><option value="">All types</option>${Object.entries(META.sectors).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <div class="field-label" style="margin-top:12px">Show</div>
        <div class="pills wide" id="msPills"><button type="button" data-m="0">All</button><button type="button" data-m="50">Good + strong</button><button type="button" data-m="70">Strong only</button></div>
        <label class="check" style="margin-top:10px"><input type="checkbox" id="hideC" ${matchState.hideContacted ? 'checked' : ''}> Hide companies already contacted</label>
      </section>
      <section><div class="summary-stats" id="summary"></div></section>
      <section id="impact5" class="impact-section"></section>
    </div>
    <div>
      <div class="card">
        <div class="card-head">
          <div><h2 id="resTitle">Matching heat users</h2><div class="muted" style="font-size:12.5px">Best matches first. Click a company for its full business case.</div></div>
          <div class="toolbar">
            <div class="legend"><span><i style="background:${css('--heat-600')}"></i>Strong</span><span><i style="background:#f6c48f"></i>Good</span><span><i style="background:#c3ccd8"></i>Weak</span></div>
            <button class="btn sm" id="top5" title="Select the 5 best matches you haven't contacted yet">☆ Select top 5</button>
            <div class="seg"><button data-v="map">Map + list</button><button data-v="list">List only</button></div>
          </div>
        </div>
        <div id="smap" class="map"></div>
        <div class="table-wrap"><table class="match-table">
          <thead><tr><th style="width:36px"><input type="checkbox" id="all" title="Select all" aria-label="Select all"></th><th>Company</th><th>Type</th><th class="r">Distance</th><th>Match</th><th>Status</th></tr></thead>
          <tbody id="mrows"></tbody></table></div>
      </div>
      <div class="actionbar" id="abar" hidden><span id="selInfo"></span><span class="toolbar"><button class="btn sm" id="clearSel" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.3)">Clear</button><button class="btn heat" id="sendBtn">Next: write the email →</button></span></div>
    </div>
  </div>`;

  function renderFacts() {
    $('#facts').innerHTML = [
      ['Cremators', `${site.units} <small>× ${esc(site.model)}</small>`, ''],
      ['Cremations / yr', n0(site.cremationsPerYear), ''],
      ['Running hours', `${site.hoursPerDay}h <small>× ${site.daysPerWeek} days/wk</small>`, 'Heat is only available while the cremators run.'],
      ['Heat output', `${n0(site.recoverableKW)} <small>kW</small>`, 'How much heat can be recovered at any moment while running.'],
      ['Water temp.', `${site.supplyTempC} <small>°C</small>`, 'Temperature of the hot water we can supply. Companies needing hotter water are harder to serve.'],
      ['Waste heat / year', `${n0(site.supplyMWh)} <small>MWh</small>`, '1 MWh heats an average home for about 1–2 months.'],
    ].map(([k, v, h]) => `<div class="fact"><div class="k">${k}${h ? ' ' + tip(h) : ''}</div><div class="v">${v}</div></div>`).join('');
  }
  renderFacts();

  $('#sector').value = matchState.sector;
  $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.v === matchState.view));
  $('#smap').style.display = matchState.view === 'map' ? '' : 'none';

  map = baseMap($('#smap'), { preferCanvas: false });
  map.setView([site.lat, site.lon], 11);
  layer = L.layerGroup().addTo(map);
  L.marker([site.lat, site.lon], { icon: L.divIcon({ className: 'site-pin', iconSize: [18, 18] }), zIndexOffset: 1000 })
    .bindTooltip(`<b>${esc(site.name)}</b><br>${n0(site.supplyMWh)} MWh/yr surplus`, { direction: 'top' }).addTo(map);

  function outputs() {
    $('#rOut').textContent = dist(matchState.radius);
    $$('#rPills button').forEach(b => b.classList.toggle('on', +b.dataset.r === matchState.radius));
    $$('#presets button').forEach(b => b.classList.toggle('on', b.dataset.p === matchState.preset));
    $$('#msPills button').forEach(b => b.classList.toggle('on', +b.dataset.m === matchState.minScore));
    ['we', 'wl', 'wf'].forEach(k => { $('#' + k).value = matchState[k]; });
    const sum = (+matchState.we + +matchState.wl + +matchState.wf) || 1;
    $('#weOut').textContent = Math.round(matchState.we / sum * 100) + '%';
    $('#wlOut').textContent = Math.round(matchState.wl / sum * 100) + '%';
    $('#wfOut').textContent = Math.round(matchState.wf / sum * 100) + '%';
  }

  let fetchTimer;
  async function load(fit) {
    outputs();
    data = await api(`/sites/${id}/matches?radius=${matchState.radius}&we=${matchState.we}&wl=${matchState.wl}&wf=${matchState.wf}`);
    render(fit);
  }
  function visible() {
    return data.users.filter(u => (!matchState.sector || u.sector === matchState.sector) && u.score.total >= matchState.minScore && !(matchState.hideContacted && u.lead));
  }
  function render(fit) {
    const list = visible();
    for (const id of [...selected]) if (!list.some(u => u.id === id)) selected.delete(id);
    $('#resTitle').textContent = `${list.length} business${list.length === 1 ? '' : 'es'} could use this heat`;
    $('#summary').innerHTML = `
      <div><b>${list.filter(u => u.score.total >= 70).length}</b><span>strong matches</span></div>
      <div><b>${list.filter(u => u.score.total >= 50 && u.score.total < 70).length}</b><span>good matches</span></div>
      <div><b>${n0(site.supplyMWh)}</b><span>MWh/yr we can supply</span></div>
      <div><b>${n0(Math.max(0, ...list.map(u => u.score.co2Tonnes)))}</b><span>t CO₂/yr saved by the best match</span></div>`;
    // impact if the 5 best matches sign (capped at the heat this site actually has)
    const top5 = list.slice(0, 5), mwh5 = Math.min(site.supplyMWh, top5.reduce((a, u) => a + u.score.deliveredMWh, 0)), im5 = impactOf(mwh5);
    $('#impact5').innerHTML = top5.length ? `<h3 class="ctl-title" style="margin-bottom:8px">🌱 If the ${top5.length} best sign ${tip(impactMethod())}</h3>
      <div class="impact-mini"><b>${n0(im5.co2Tonnes)}</b> t CO₂ avoided / year</div>
      <div class="impact-mini-eq">${n0(im5.heatMWh)} MWh heat · 🏠 ${n0(im5.homes)} homes · 🚗 ${n0(im5.cars)} cars · ${pct(mwh5 / site.supplyMWh)} of this site's waste heat used</div>` : '';
    $('#mrows').innerHTML = list.map(u => `
      <tr class="clickable ${selected.has(u.id) ? 'selected' : ''}" data-id="${u.id}">
        <td><input type="checkbox" class="sel" ${selected.has(u.id) ? 'checked' : ''}></td>
        <td class="co"><div><span class="rank">${u.rank}</span><b>${esc(u.name)}</b></div><div class="whys">${reasons(u, site)}</div></td>
        <td>${esc(u.sectorLabel)}</td>
        <td class="r num">${dist(u.distanceKm)}</td>
        <td>${scoreBar(u.score.total)}</td>
        <td>${u.lead ? statusBadge(u.lead.status) : '<span class="muted" style="font-size:12.5px">Not contacted</span>'}</td>
      </tr>`).join('') || `<tr><td colspan="6" class="empty">No businesses match these settings.<div class="toolbar" style="justify-content:center;margin-top:12px">
        ${matchState.radius < 1 ? '<button class="btn sm" id="widen">Search up to 1 km</button>' : ''}<button class="btn sm" id="resetF">Show all businesses</button></div></td></tr>`;
    const w = $('#widen'); if (w) w.onclick = () => { matchState.radius = 1; $('#radius').value = 1; load(true); };
    const rf = $('#resetF'); if (rf) rf.onclick = () => { Object.assign(matchState, { sector: '', minScore: 0, hideContacted: false }); $('#sector').value = ''; $('#hideC').checked = false; outputs(); render(false); };
    $('#all').checked = list.length > 0 && list.every(u => selected.has(u.id));
    // map
    layer.clearLayers();
    if (circle) circle.remove();
    circle = L.circle([site.lat, site.lon], { radius: matchState.radius * 1000, color: '#6b7277', weight: 1.5, dashArray: '6 6', fillColor: css('--ft-orange'), fillOpacity: .05, interactive: false }).addTo(map);
    list.forEach(u => {
      const m = L.circleMarker([u.lat, u.lon], { radius: selected.has(u.id) ? 10 : 7, color: selected.has(u.id) ? css('--brand-900') : '#fff', weight: selected.has(u.id) ? 3 : 1.5, fillColor: scoreColor(u.score.total), fillOpacity: .95 })
        .bindTooltip(`<b>${esc(u.name)}</b><br>${esc(u.sectorLabel)} · score ${u.score.total}`, { direction: 'top' })
        .on('click', () => openUser(u));
      layer.addLayer(m);
      if (u.score.total >= 70) layer.addLayer(L.polyline([[site.lat, site.lon], [u.lat, u.lon]], { color: css('--heat-500'), weight: 1, opacity: .35, interactive: false }));
    });
    if (fit) map.fitBounds(circle.getBounds(), { padding: [10, 10] });
    updateBar();
  }
  function updateBar() {
    $('#abar').hidden = selected.size === 0;
    $('#selInfo').innerHTML = `<b>${selected.size}</b> compan${selected.size === 1 ? 'y' : 'ies'} selected. Next, you'll see the email before anything is sent.`;
  }
  function toggle(id, on) { on ? selected.add(id) : selected.delete(id); render(false); }

  function openUser(u) {
    const s = u.score;
    const sc = (label, v) => `<div class="mini"><span>${label}</span><div class="bar"><i style="width:${v}%;background:${scoreColor(v)}"></i></div><b class="num" style="text-align:right">${v}</b></div>`;
    openDrawer(`
      <div class="modal-head"><div><div class="muted" style="font-size:12px">#${u.rank} · ${esc(u.sectorLabel)}</div><h2>${esc(u.name)}</h2></div><button class="x" data-close>×</button></div>
      <div class="modal-body">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px"><div style="font-size:40px;font-weight:800;color:${scoreColor(s.total)};line-height:1">${s.total}</div><div class="muted"><b style="color:var(--brand-900)">${scoreWord(s.total)} match</b> (score out of 100)<br>${u.lead ? statusBadge(u.lead.status) : 'Not contacted yet'}</div></div>
        <div class="whys" style="margin-bottom:14px">${reasons(u, site)}</div>
        ${sc('Heat demand fit', s.energy)}${sc('Chance of signing', s.likelihood)}${sc('Cost to connect', s.feasibility)}
        <h3 class="section-title">Business case (indicative)</h3>
        <dl class="kv">
          <dt>Heat deliverable</dt><dd>${n0(s.deliveredMWh)} MWh/yr <span class="muted" style="font-weight:400">(🏠 ${n0(s.homes)} homes)</span></dd>
          <dt>Annual savings for customer</dt><dd>${eur(s.annualSavings)}</dd>
          <dt>CO₂ avoided</dt><dd>${n0(s.co2Tonnes)} t/yr <span class="muted" style="font-weight:400">(🚗 ${n0(s.co2Tonnes / META.econ.carCO2t)} cars)</span></dd>
          <dt>Connection capex</dt><dd>${eur(s.capex)}</dd>
          <dt>Payback time ${tip('Years until the cost of the connection is paid back by the heat savings.')}</dt><dd>${s.paybackYears > 40 ? '> 40' : n1(s.paybackYears)} years</dd>
          <dt>Temperature margin ${tip('How much hotter our water is than what they need. Negative means we cannot fully meet their needs.')}</dt><dd>${s.tempGap > 0 ? '+' : ''}${s.tempGap} °C</dd>
        </dl>
        <h3 class="section-title">Profile</h3>
        <dl class="kv">
          <dt>Distance</dt><dd>${dist(u.distanceKm)}</dd>
          <dt>Annual heat demand</dt><dd>${n0(u.annualDemandMWh)} MWh</dd>
          <dt>Required temperature</dt><dd>${u.requiredTempC} °C</dd>
          <dt>Demand matches cremator hours</dt><dd>${pct(u.profileFit)}</dd>
          <dt>Current heating</dt><dd>${esc(u.currentFuel)}, ${u.heatingSystemAge} yrs old</dd>
          <dt>Sustainability</dt><dd>${esc(u.sustainability)}</dd>
          <dt>Public sector</dt><dd>${u.publicSector ? 'Yes' : 'No'}</dd>
        </dl>
        <h3 class="section-title">Contact</h3>
        <div>${esc(u.contact.name)}, ${esc(u.contact.role)}<br><span class="muted">${esc(u.contact.email)} · ${esc(u.contact.phone)}</span></div>
      </div>
      <div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn heat" id="dSel">${selected.has(u.id) ? 'Remove from selection' : 'Add to outreach'}</button></div>`,
      el => { $('#dSel', el).onclick = () => { toggle(u.id, !selected.has(u.id)); closeModal(); }; });
  }

  // events
  const debounced = fit => { clearTimeout(fetchTimer); fetchTimer = setTimeout(() => load(fit), 120); };
  $('#radius').oninput = e => { matchState.radius = +e.target.value; outputs(); debounced(true); };
  ['we', 'wl', 'wf'].forEach(k => $('#' + k).oninput = e => { matchState[k] = +e.target.value; matchState.preset = 'custom'; outputs(); debounced(false); });
  $('#rPills').onclick = e => { const b = e.target.closest('button'); if (b) { matchState.radius = +b.dataset.r; $('#radius').value = matchState.radius; load(true); } };
  $('#presets').onclick = e => { const b = e.target.closest('button'); if (!b) return; const p = PRESETS[b.dataset.p];
    matchState.preset = b.dataset.p; [matchState.we, matchState.wl, matchState.wf] = p.w; load(false); };
  $('#msPills').onclick = e => { const b = e.target.closest('button'); if (b) { matchState.minScore = +b.dataset.m; outputs(); render(false); } };
  $('#top5').onclick = () => { visible().filter(u => !u.lead).slice(0, 5).forEach(u => selected.add(u.id)); render(false); if (selected.size) $('#abar').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
  $('#sector').onchange = e => { matchState.sector = e.target.value; render(false); };
  $('#hideC').onchange = e => { matchState.hideContacted = e.target.checked; render(false); };
  $$('.seg button').forEach(b => b.onclick = () => {
    matchState.view = b.dataset.v; $$('.seg button').forEach(x => x.classList.toggle('on', x === b));
    $('#smap').style.display = matchState.view === 'map' ? '' : 'none'; if (matchState.view === 'map') map.invalidateSize();
  });
  $('#all').onchange = e => { visible().forEach(u => e.target.checked ? selected.add(u.id) : selected.delete(u.id)); render(false); };
  $('#mrows').onclick = e => {
    const tr = e.target.closest('tr[data-id]'); if (!tr) return;
    if (e.target.classList.contains('sel')) return toggle(tr.dataset.id, e.target.checked);
    openUser(data.users.find(u => u.id === tr.dataset.id));
  };
  $('#clearSel').onclick = () => { selected.clear(); render(false); };
  $('#sendBtn').onclick = () => openOutreach(site, data.users.filter(u => selected.has(u.id)), async () => { selected.clear(); await loadSite(); await load(false); refreshCounts(); });
  $('#editBtn').onclick = () => openEditSite(site, async () => { await loadSite(); renderFacts(); await load(false); });

  await load(true);
}

// ----- outreach email modal -----
function openOutreach(site, users, done) {
  let idx = 0;
  const vars = u => ({ company: u.name, contact_name: u.contact.name, site_name: site.name, city: site.city, distance: dist(u.distanceKm), supply_temp: site.supplyTempC,
    delivered_mwh: n0(u.score.deliveredMWh), savings: n0(u.score.annualSavings), co2: n0(u.score.co2Tonnes), payback: u.score.paybackYears, sender: $('#oSender')?.value || 'FT Heat Partnerships' });
  const fill = (t, v) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? esc(v[k]) : esc(m)));
  openModal(`
    <div class="modal-head"><div><h2>Email ${users.length} compan${users.length === 1 ? 'y' : 'ies'}</h2><div class="muted" style="font-size:12.5px">Each email is personalised automatically. Check the preview on the right, then send.</div></div><button class="x" data-close>×</button></div>
    <div class="modal-body grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px">
      <div>
        <label class="field">Sender name<input type="text" id="oSender" value="FT Heat Partnerships"></label>
        <label class="field" style="margin-top:12px">Subject<input type="text" id="oSubj" value="${esc(META.template.subject)}"></label>
        <label class="field" style="margin-top:12px">Message template<textarea id="oBody" rows="14">${esc(META.template.body)}</textarea></label>
        <div style="margin-top:8px" class="muted">The {{…}} fields are filled in for each company. Click one to add it:</div>
        <div class="chips" style="margin-top:6px">${['company', 'contact_name', 'site_name', 'city', 'distance', 'supply_temp', 'delivered_mwh', 'savings', 'co2', 'payback', 'sender'].map(k => `<button class="chip" data-k="${k}">{{${k}}}</button>`).join('')}</div>
        <label class="check" style="margin-top:12px"><input type="checkbox" id="oSave" checked> Save as default template</label>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3>Preview</h3>
          <span class="toolbar"><button class="btn sm" id="pPrev">‹</button><span class="muted" id="pIdx"></span><button class="btn sm" id="pNext">›</button></span></div>
        <div class="muted" style="font-size:12.5px;margin-bottom:6px" id="pTo"></div>
        <div class="email-preview" id="preview"></div>
        <h3 class="section-title">Recipients</h3>
        <div style="max-height:150px;overflow:auto;font-size:13px">${users.map(u => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)"><span>${esc(u.name)}</span><span class="muted">${esc(u.contact.email)}</span></div>`).join('')}</div>
      </div>
    </div>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn heat" id="oSend">✉ Send ${users.length} email${users.length === 1 ? '' : 's'}</button></div>`,
  el => {
    el.querySelector('.modal').classList.add('wide');
    const upd = () => {
      const u = users[idx];
      $('#pIdx', el).textContent = `${idx + 1} / ${users.length}`;
      $('#pTo', el).textContent = `To: ${u.contact.name} <${u.contact.email}>`;
      $('#preview', el).innerHTML = `<div class="subj">${fill($('#oSubj', el).value, vars(u))}</div>${fill($('#oBody', el).value, vars(u))}`;
    };
    ['#oSubj', '#oBody', '#oSender'].forEach(s => $(s, el).oninput = upd);
    $('#pPrev', el).onclick = () => { idx = (idx - 1 + users.length) % users.length; upd(); };
    $('#pNext', el).onclick = () => { idx = (idx + 1) % users.length; upd(); };
    $$('.chip', el).forEach(c => c.onclick = () => { const ta = $('#oBody', el); const p = ta.selectionStart; ta.value = ta.value.slice(0, p) + `{{${c.dataset.k}}}` + ta.value.slice(ta.selectionEnd); ta.focus(); upd(); });
    $('#oSend', el).onclick = async () => {
      const b = $('#oSend', el); b.disabled = true; b.textContent = 'Sending…';
      try {
        const r = await api('/outreach', { method: 'POST', body: { siteId: site.id, userIds: users.map(u => u.id), subject: $('#oSubj', el).value, body: $('#oBody', el).value, sender: $('#oSender', el).value, saveTemplate: $('#oSave', el).checked, weights: { energy: matchState.we, likelihood: matchState.wl, feasibility: matchState.wf } } });
        if ($('#oSave', el).checked) META.template = { subject: $('#oSubj', el).value, body: $('#oBody', el).value };
        closeModal(); toast(`${r.sent.length} email${r.sent.length === 1 ? '' : 's'} sent and added to the pipeline`); done();
      } catch (e) { alert(e.message); b.disabled = false; b.textContent = 'Send'; }
    };
    upd();
  });
}

// ----- collect / update cremator data -----
function openEditSite(site, done) {
  const f = (k, label, unit, attrs = '') => `<label class="field">${label}${unit ? ` (${unit})` : ''}<input type="number" name="${k}" value="${site[k]}" ${attrs}></label>`;
  openModal(`
    <div class="modal-head"><div><div class="muted" style="font-size:12px">Collect data · ${esc(site.id)}</div><h2>Update operating data</h2></div><button class="x" data-close>×</button></div>
    <form id="ef"><div class="modal-body">
      <p class="muted" style="margin-top:0">Enter the latest figures from the site or the cremator control system. Matching and business cases update straight away.</p>
      <div class="form-grid">
        ${f('units', 'Number of cremators', '', 'min=1 max=6')}
        ${f('cremationsPerYear', 'Cremations per year', '', 'min=0 max=20000')}
        ${f('hoursPerDay', 'Operating hours per day', 'h', 'min=1 max=24')}
        ${f('daysPerWeek', 'Operating days per week', '', 'min=1 max=7')}
        ${f('recoverableKW', 'Recoverable heat output', 'kW', 'min=0 max=5000')}
        ${f('supplyTempC', 'Supply temperature', '°C', 'min=30 max=120')}
        <label class="field">Site contact<input type="text" name="cname" value="${esc(site.contact.name)}"></label>
        <label class="field">Contact email<input type="email" name="cemail" value="${esc(site.contact.email)}"></label>
      </div>
      <label class="check" style="margin-top:14px"><input type="checkbox" name="hr" ${site.heatRecoveryInstalled ? 'checked' : ''}> Heat-recovery unit already installed</label>
      <p class="muted" style="font-size:12px;margin-bottom:0">Last service: ${esc(site.lastServiceDate)}${site.dataUpdatedAt ? ` · Data last updated ${date(site.dataUpdatedAt)}` : ''}</p>
    </div>
    <div class="modal-foot"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary" type="submit">Save data</button></div></form>`,
  el => {
    $('#ef', el).onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(['units', 'cremationsPerYear', 'hoursPerDay', 'daysPerWeek', 'recoverableKW', 'supplyTempC'].map(k => [k, fd.get(k)]));
      body.heatRecoveryInstalled = fd.get('hr') === 'on';
      body.contact = { name: fd.get('cname'), email: fd.get('cemail') };
      try { await api('/sites/' + site.id, { method: 'PUT', body }); closeModal(); toast('Operating data saved'); done(); } catch (err) { alert(err.message); }
    };
  });
}

// ======================= PIPELINE =======================
const pipeState = { q: '', country: '', sector: '' };
async function viewPipeline(app) {
  let leads = await api('/leads');
  app.innerHTML = `
  <div class="page-head"><div><h1>Partnership pipeline</h1><p>Follow every deal from first email to signed contract. Use <b>Move to</b> on a card (or drag it) to update it; click a card for details and notes.</p></div>
    <div class="toolbar">
      <input type="text" id="pq" placeholder="Search company or site…" value="${esc(pipeState.q)}">
      <select id="pc"><option value="">All countries</option>${[...new Set(leads.map(l => l.country))].sort().map(c => `<option value="${c}">${esc(META.countries[c] || c)}</option>`).join('')}</select>
      <select id="ps"><option value="">All sectors</option>${Object.entries(META.sectors).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
    </div></div>
  <div class="kanban" id="kb"></div>`;
  $('#pc').value = pipeState.country; $('#ps').value = pipeState.sector;
  function render() {
    const q = pipeState.q.toLowerCase();
    const list = leads.filter(l => (!q || (l.userName + l.siteName).toLowerCase().includes(q)) && (!pipeState.country || l.country === pipeState.country) && (!pipeState.sector || l.sector === pipeState.sector));
    $('#kb').innerHTML = META.statuses.map(s => {
      const items = list.filter(l => l.status === s);
      const mwh = items.reduce((a, l) => a + l.deliveredMWh, 0);
      return `<div class="col" data-status="${esc(s)}"><div class="col-head">${statusBadge(s)}<span class="muted">${items.length} · ${n0(mwh / 1000)} GWh</span></div>
        <div class="col-body">${items.slice(0, 120).map(l => `<div class="kcard" draggable="true" data-id="${l.id}">
          <div class="t">${esc(l.userName)}</div><div class="m">${esc(l.sectorLabel)}</div><div class="m">↳ ${esc(l.siteName)}</div>
          <div class="f"><span class="tag">${scoreWord(l.score)} · ${l.score}</span><span class="muted">${n0(l.deliveredMWh)} MWh · ${dist(l.distanceKm)}</span></div>
          <label class="move">Move to <select data-id="${l.id}" aria-label="Move ${esc(l.userName)} to another stage">${META.statuses.map(o => `<option ${o === l.status ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label></div>`).join('')}
          ${items.length ? '' : '<div class="col-empty">Nothing here yet</div>'}
          ${items.length > 120 ? `<div class="muted" style="text-align:center;font-size:12px">+${items.length - 120} more, use the filters</div>` : ''}</div></div>`;
    }).join('');
  }
  $('#pq').oninput = e => { pipeState.q = e.target.value; render(); };
  $('#pc').onchange = e => { pipeState.country = e.target.value; render(); };
  $('#ps').onchange = e => { pipeState.sector = e.target.value; render(); };
  const kb = $('#kb');
  kb.addEventListener('dragstart', e => { const c = e.target.closest('.kcard'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.id); c.style.opacity = .5; } });
  kb.addEventListener('dragend', e => { const c = e.target.closest('.kcard'); if (c) c.style.opacity = ''; });
  kb.addEventListener('dragover', e => { const col = e.target.closest('.col'); if (col) { e.preventDefault(); $$('.col', kb).forEach(c => c.classList.toggle('over', c === col)); } });
  kb.addEventListener('dragleave', e => { if (!kb.contains(e.relatedTarget)) $$('.col', kb).forEach(c => c.classList.remove('over')); });
  kb.addEventListener('drop', async e => {
    e.preventDefault(); $$('.col', kb).forEach(c => c.classList.remove('over'));
    const col = e.target.closest('.col'); const id = e.dataTransfer.getData('text/plain');
    const l = leads.find(x => x.id === id); if (!col || !l || l.status === col.dataset.status) return;
    const upd = await api('/leads/' + id, { method: 'PATCH', body: { status: col.dataset.status, note: 'Moved on pipeline board' } });
    Object.assign(l, upd); render(); toast(`${l.userName} → ${l.status}`);
  });
  kb.addEventListener('change', async e => {
    const sel = e.target.closest('.move select'); if (!sel) return;
    const l = leads.find(x => x.id === sel.dataset.id); if (!l || l.status === sel.value) return;
    const upd = await api('/leads/' + l.id, { method: 'PATCH', body: { status: sel.value, note: 'Moved on pipeline board' } });
    Object.assign(l, upd); render(); toast(`${l.userName} → ${l.status}`);
  });
  kb.addEventListener('click', e => { if (e.target.closest('.move')) return; const c = e.target.closest('.kcard'); if (c) openLead(leads.find(l => l.id === c.dataset.id), upd => { const l = leads.find(x => x.id === upd.id); Object.assign(l, upd); render(); }); });
  render();
}

function openLead(l, done) {
  openDrawer(`
    <div class="modal-head"><div><div class="muted" style="font-size:12px">${esc(l.id)} · ${esc(l.sectorLabel)}</div><h2>${esc(l.userName)}</h2></div><button class="x" data-close>×</button></div>
    <div class="modal-body">
      <dl class="kv">
        <dt>Heat source</dt><dd><a href="#/site/${l.siteId}" data-close>${esc(l.siteName)}</a></dd>
        <dt>Distance</dt><dd>${dist(l.distanceKm)}</dd>
        <dt>Match score</dt><dd>${l.score}</dd>
        <dt>Heat deliverable</dt><dd>${n0(l.deliveredMWh)} MWh/yr</dd>
        <dt>CO₂ avoided</dt><dd>${n0(l.co2Tonnes)} t/yr</dd>
        <dt>Connection capex</dt><dd>${eur(l.capex)}</dd>
        <dt>Payback</dt><dd>${l.paybackYears > 40 ? '> 40' : n1(l.paybackYears)} yrs</dd>
        <dt>Contact</dt><dd>${esc(l.contact.name)}<br><span class="muted" style="font-weight:400">${esc(l.contact.email)}</span></dd>
      </dl>
      <h3 class="section-title">Update status</h3>
      <select id="lS">${META.statuses.map(s => `<option ${s === l.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>
      <textarea id="lN" rows="3" placeholder="Add a note (e.g. meeting outcome, next step)…" style="margin-top:8px"></textarea>
      <button class="btn primary" id="lSave" style="margin-top:8px">Save update</button>
      <h3 class="section-title">History</h3>
      <ul class="timeline">${l.history.slice().reverse().map(h => `<li><b>${esc(h.status)}</b> <span class="muted">· ${date(h.at)}</span>${h.note ? `<br>${esc(h.note)}` : ''}</li>`).join('')}</ul>
    </div>`,
  el => {
    $('#lSave', el).onclick = async () => {
      const upd = await api('/leads/' + l.id, { method: 'PATCH', body: { status: $('#lS', el).value, note: $('#lN', el).value } });
      closeModal(); toast('Lead updated'); done(upd);
    };
  });
}

// ======================= OUTBOX =======================
async function viewOutbox(app) {
  const mails = await api('/outbox');
  app.innerHTML = `
  <div class="page-head"><div><h1>Outbox</h1><p>Every outreach email sent from HeatMatch. Demo mode: emails are logged here, not delivered.</p></div></div>
  <div class="card grid mail-layout" style="gap:0">
    <div class="mail-list">${mails.map((m, i) => `<div class="mail-item" data-i="${i}"><div class="to"><span>${esc(m.company)}</span><span class="muted" style="font-weight:400;font-size:12px">${ago(m.at)}</span></div><div class="s">${esc(m.subject)}</div><div class="muted" style="font-size:12px">via ${esc(m.siteName)}</div></div>`).join('') || '<div class="empty">No emails sent yet.<br>Pick a crematorium, select the businesses you like and send them an email.<br><a class="btn sm primary" href="#/installations" style="margin-top:12px">Find heat users →</a></div>'}</div>
    <div class="card-pad" id="mview">${mails.length ? '' : ''}</div>
  </div>`;
  const show = i => {
    $$('.mail-item').forEach(x => x.classList.toggle('on', +x.dataset.i === i));
    const m = mails[i];
    $('#mview').innerHTML = `<h2>${esc(m.subject)}</h2>
      <dl class="kv" style="margin:12px 0 16px;grid-template-columns:80px 1fr"><dt>To</dt><dd style="text-align:left">${esc(m.to)}</dd><dt>Sent</dt><dd style="text-align:left">${new Date(m.at).toLocaleString('en-GB')}</dd><dt>Source</dt><dd style="text-align:left"><a href="#/site/${m.siteId}">${esc(m.siteName)}</a></dd></dl>
      <div class="email-preview" style="max-height:none">${esc(m.body)}</div>`;
  };
  $$('.mail-item').forEach(x => x.onclick = () => show(+x.dataset.i));
  if (mails.length) show(0);
}

// ======================= modal helpers =======================
function openModal(html, init) { mount(`<div class="overlay"><div class="modal">${html}</div></div>`, init); }
function openDrawer(html, init) { mount(`<div class="overlay right"><div class="drawer">${html}</div></div>`, init); }
function mount(html, init) {
  const root = $('#modalRoot'); root.innerHTML = html;
  const ov = root.firstElementChild;
  ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
  $$('[data-close]', ov).forEach(b => b.addEventListener('click', closeModal));
  init && init(ov);
}
function closeModal() { $('#modalRoot').innerHTML = ''; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });


// ======================= LOGIN =======================
// The sign-in lives only as long as this browser tab: closing the tab/window signs you out,
// reloading the page keeps you signed in (sessionStorage is per tab and survives reloads).
let tabFlag = false;
function tabSignedIn() { try { return sessionStorage.getItem('hm-tab') === '1'; } catch (_) { return tabFlag; } }
function setTabSignedIn(v) { tabFlag = v; try { v ? sessionStorage.setItem('hm-tab', '1') : sessionStorage.removeItem('hm-tab'); } catch (_) {} }
function showLogin(errorMsg) {
  SESSION = null; setTabSignedIn(false); closeModal(); destroyMaps();
  document.body.classList.add('locked');
  const logo = document.querySelector('.brand img').getAttribute('src');
  $('#app').innerHTML = `
  <div class="login-wrap">
    <form class="login-card card" id="loginForm" novalidate>
      <img src="${logo}" alt="FT" class="login-logo">
      <h1>Heat<span style="color:var(--ft-orange)">Match</span></h1>
      <p class="muted" style="margin:4px 0 22px">Sign in to the heat partnership platform</p>
      <label class="field">Email<input type="email" name="email" id="lEmail" placeholder="name@alumni.esade.edu" autocomplete="username" required></label>
      <label class="field" style="margin-top:14px">Password<input type="password" name="password" id="lPass" autocomplete="current-password" required></label>
      <div class="login-error" id="lErr" role="alert">${errorMsg ? esc(errorMsg) : ''}</div>
      <button class="btn primary login-btn" type="submit">Sign in</button>
      <p class="muted login-foot">Access is restricted to authorised ESADE alumni accounts.</p>
    </form>
  </div>`;
  $('#lEmail').focus();
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button'); btn.disabled = true; btn.textContent = 'Signing in…';
    try {
      const r = await api('/login', { method: 'POST', body: { email: $('#lEmail').value, password: $('#lPass').value } });
      SESSION = r.email; setTabSignedIn(true);
      document.body.classList.remove('locked');
      renderUser(); refreshCounts();
      if (!location.hash || location.hash === '#/login') location.hash = '#/overview'; else route();
    } catch (err) {
      $('#lErr').textContent = err.message; btn.disabled = false; btn.textContent = 'Sign in';
      $('#lPass').value = ''; $('#lPass').focus();
    }
  };
}
function renderUser() {
  $('#userBox').innerHTML = SESSION ? `<div class="avatar">${esc(SESSION[0].toUpperCase())}</div>
    <div style="min-width:0"><div class="user-email" title="${esc(SESSION)}">${esc(SESSION)}</div><button class="link-btn" id="logoutBtn" style="padding:0">Sign out</button></div>` : '';
  const b = $('#logoutBtn'); if (b) b.onclick = async () => { try { await api('/logout', { method: 'POST' }); } catch (_) {} showLogin(); };
}

// ======================= router =======================
async function refreshCounts() { try { const o = await api('/outbox'); $('#outboxCount').textContent = o.length || ''; } catch {} }
async function route() {
  closeModal(); destroyMaps(); document.body.classList.remove('menu');
  const [, page = 'overview', arg] = location.hash.split('/');
  $$('nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === (page === 'site' ? 'installations' : page)));
  const app = $('#app');
  app.innerHTML = '<div class="empty">Loading…</div>';
  try {
    if (!SESSION && !tabSignedIn()) { try { await api('/logout', { method: 'POST' }); } catch (_) {} return showLogin(); }
    if (!SESSION) { SESSION = (await api('/session')).email; document.body.classList.remove('locked'); renderUser(); refreshCounts(); }
    if (!META) META = await api('/meta');
    if (page === 'installations') await viewInstallations(app);
    else if (page === 'site' && arg) await viewSite(app, arg);
    else if (page === 'pipeline') await viewPipeline(app);
    else if (page === 'outbox') await viewOutbox(app);
    else await viewOverview(app);
    window.scrollTo(0, 0);
  } catch (e) { if (e.auth) return; app.innerHTML = `<div class="empty">Something went wrong: ${esc(e.message)}<br><a href="#/overview">Back to overview</a></div>`; console.error(e); }
}
window.addEventListener('hashchange', route);
$('#menuBtn').onclick = () => document.body.classList.toggle('menu');
$('#resetBtn').onclick = async () => { if (confirm('Reset all demo data (pipeline, emails, edits) to the starting state?')) { await api('/reset', { method: 'POST' }); META = null; toast('Demo data reset'); refreshCounts(); route(); } };
route();
})();
