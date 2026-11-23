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
const scoreBar = v => `<div class="score"><b>${v}</b><div class="bar"><i style="width:${v}%;background:${scoreColor(v)}"></i></div></div>`;

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

  app.innerHTML = `
  <div class="page-head">
    <div><h1>Global overview</h1><p>Surplus heat from FT cremators worldwide and the partnerships built on it.</p></div>
    <a class="btn primary" href="#/installations">Find heat users for an installation →</a>
  </div>
  <div class="grid kpis">
    <div class="card kpi"><div class="label">Cremators</div><div class="value">${n0(t.units)}</div><div class="sub">${n0(t.sites)} sites · ${t.countries} countries · ${pct(t.europeUnits / t.units)} in Europe</div></div>
    <div class="card kpi accent"><div class="label">Recoverable heat</div><div class="value">${n0(t.supplyGWh)}<small>GWh/yr</small></div><div class="sub">Surplus heat across the installed base</div></div>
    <div class="card kpi"><div class="label">Signed partnerships</div><div class="value">${n0(t.partnerships)}</div><div class="sub">${t.sitesWithPartnership} sites · ${pct(t.sitesWithPartnership / t.sites)} of the network</div></div>
    <div class="card kpi"><div class="label">Heat delivered</div><div class="value">${n1(t.deliveredGWh)}<small>GWh/yr</small></div><div class="sub">${n0(t.co2Tonnes)} t CO₂ avoided per year</div></div>
    <div class="card kpi"><div class="label">Active pipeline</div><div class="value">${n0(t.activeLeads)}</div><div class="sub">${t.sitesInProgress} sites in progress · ${n0(t.emailsSent)} emails sent</div></div>
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

  const map = baseMap($('#gmap')).setView([51.5, 6], 4);
  const col = { partnership: css('--ok-600'), progress: css('--ft-orange'), none: '#b4b8bb' };
  const order = { none: 0, progress: 1, partnership: 2 };
  sites.slice().sort((a, b) => order[a.status] - order[b.status]).forEach(s => {
    L.circleMarker([s.lat, s.lon], { radius: s.status === 'none' ? 4 : 6, color: '#fff', weight: 1, fillColor: col[s.status], fillOpacity: .9 })
      .bindPopup(`<h4>${esc(s.name)}</h4><div class="muted">${esc(s.city)}, ${esc(s.countryName)}</div>
        <div style="margin:8px 0">${s.units} × ${esc(s.model)} · ${n0(s.supplyMWh)} MWh/yr surplus<br>${s.leads} leads · ${s.signed} signed</div>
        <a class="btn sm primary" href="#/site/${s.id}">Open matching →</a>`).addTo(map);
  });
}

// ======================= INSTALLATIONS =======================
const instState = { q: '', country: '', status: '', page: 0, sort: 'supplyMWh' };
async function viewInstallations(app) {
  const sites = await api('/sites');
  const countries = [...new Map(sites.map(s => [s.country, s.countryName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  app.innerHTML = `
  <div class="page-head"><div><h1>Installations</h1><p>${n0(sites.reduce((a, s) => a + s.units, 0))} FT cremators at ${sites.length} sites. Pick one to find heat users nearby.</p></div></div>
  <div class="card">
    <div class="card-head"><div class="toolbar">
      <input type="text" id="q" placeholder="Search by name, city or ID…" value="${esc(instState.q)}">
      <select id="country"><option value="">All countries</option>${countries.map(([c, n]) => `<option value="${c}" ${instState.country === c ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <select id="status"><option value="">Any status</option><option value="none">No partnership yet</option><option value="progress">In progress</option><option value="partnership">Partnership</option></select>
      <select id="sort"><option value="supplyMWh">Sort: surplus heat</option><option value="name">Sort: name</option><option value="leads">Sort: leads</option></select>
    </div><span class="muted" id="count"></span></div>
    <div class="table-wrap"><table><thead><tr><th>ID</th><th>Installation</th><th>Location</th><th class="r">Cremators</th><th>Model</th><th class="r">Surplus heat</th><th>Status</th><th class="r">Leads</th></tr></thead><tbody id="rows"></tbody></table></div>
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
    $('#count').textContent = `${list.length} sites`;
    $('#rows').innerHTML = list.slice(instState.page * PER, (instState.page + 1) * PER).map(s => `
      <tr class="clickable" data-id="${s.id}"><td class="muted num">${s.id}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.city)}, ${esc(s.countryName)}</td>
      <td class="r num">${s.units}</td><td>${esc(s.model)}</td><td class="r num">${n0(s.supplyMWh)} MWh/yr</td><td>${siteBadge(s.status)}</td><td class="r num">${s.leads}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">No installations match these filters.</td></tr>';
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
const matchState = { radius: 10, we: 40, wl: 30, wf: 30, sector: '', minScore: 0, hideContacted: false, view: 'map' };
async function viewSite(app, id) {
  const selected = new Set();
  let data, site, map, layer, circle;

  async function loadSite() { site = await api('/sites/' + id); }
  await loadSite();

  app.innerHTML = `
  <div class="crumb"><a href="#/installations">Installations</a> / ${esc(site.id)}</div>
  <div class="page-head">
    <div><h1>${esc(site.name)}</h1><p>${esc(site.city)}, ${esc(site.countryName)} · ${esc(site.operator)} · ${siteBadge(site.status)}</p></div>
    <div class="toolbar"><button class="btn" id="editBtn">✎ Update operating data</button></div>
  </div>
  <div class="card facts" id="facts"></div>
  <div class="grid match-layout">
    <div class="card controls">
      <section>
        <div class="ctl-row"><span>Search radius</span><output id="rOut"></output></div>
        <input type="range" id="radius" min="1" max="30" step="0.5" value="${matchState.radius}">
        <div class="ctl-help">Heat users within this distance of the crematorium.</div>
      </section>
      <section>
        <h3 style="margin-bottom:10px">Ranking weights</h3>
        <div class="ctl-row"><span>Energy match</span><output id="weOut"></output></div>
        <input type="range" id="we" min="0" max="100" value="${matchState.we}">
        <div class="ctl-help">How much heat they need, and when.</div>
        <div class="ctl-row"><span>Contract likelihood</span><output id="wlOut"></output></div>
        <input type="range" id="wl" min="0" max="100" value="${matchState.wl}">
        <div class="ctl-help">Sector, public support, sustainability goals, boiler age.</div>
        <div class="ctl-row"><span>Technical feasibility &amp; cost</span><output id="wfOut"></output></div>
        <input type="range" id="wf" min="0" max="100" value="${matchState.wf}">
        <div class="ctl-help">Temperature fit, pipe length, payback.</div>
      </section>
      <section>
        <label class="field">Sector<select id="sector"><option value="">All sectors</option>${Object.entries(META.sectors).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
        <div class="ctl-row" style="margin-top:12px"><span>Minimum score</span><output id="msOut"></output></div>
        <input type="range" id="minScore" min="0" max="90" step="5" value="${matchState.minScore}">
        <label class="check" style="margin-top:8px"><input type="checkbox" id="hideC" ${matchState.hideContacted ? 'checked' : ''}> Hide already contacted</label>
      </section>
      <section><div class="summary-stats" id="summary"></div></section>
    </div>
    <div>
      <div class="card">
        <div class="card-head">
          <h2 id="resTitle">Matching heat users</h2>
          <div class="toolbar">
            <div class="legend"><span><i style="background:${css('--heat-600')}"></i>70+</span><span><i style="background:#f6c48f"></i>50–69</span><span><i style="background:#c3ccd8"></i>&lt;50</span></div>
            <div class="seg"><button data-v="map">Map + list</button><button data-v="list">List only</button></div>
          </div>
        </div>
        <div id="smap" class="map"></div>
        <div class="table-wrap"><table class="match-table">
          <thead><tr><th style="width:36px"><input type="checkbox" id="all" title="Select all visible"></th><th>#</th><th>Company</th><th>Sector</th><th class="r">Distance</th><th class="r">Heat demand</th><th>Match score</th><th class="r">Payback</th><th>Status</th></tr></thead>
          <tbody id="mrows"></tbody></table></div>
      </div>
      <div class="actionbar" id="abar" hidden><span id="selInfo"></span><span class="toolbar"><button class="btn sm" id="clearSel" style="background:transparent;color:#fff;border-color:rgba(255,255,255,.3)">Clear</button><button class="btn heat" id="sendBtn">✉ Send outreach email</button></span></div>
    </div>
  </div>`;

  function renderFacts() {
    $('#facts').innerHTML = [
      ['Cremators', `${site.units} <small>× ${esc(site.model)}</small>`],
      ['Cremations / yr', n0(site.cremationsPerYear)],
      ['Operating hours', `${site.hoursPerDay}h <small>× ${site.daysPerWeek} days/wk</small>`],
      ['Recoverable output', `${n0(site.recoverableKW)} <small>kW</small>`],
      ['Supply temperature', `${site.supplyTempC} <small>°C</small>`],
      ['Annual surplus heat', `${n0(site.supplyMWh)} <small>MWh/yr</small>`],
    ].map(([k, v]) => `<div class="fact"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
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
    $('#rOut').textContent = matchState.radius + ' km';
    const sum = (+matchState.we + +matchState.wl + +matchState.wf) || 1;
    $('#weOut').textContent = Math.round(matchState.we / sum * 100) + '%';
    $('#wlOut').textContent = Math.round(matchState.wl / sum * 100) + '%';
    $('#wfOut').textContent = Math.round(matchState.wf / sum * 100) + '%';
    $('#msOut').textContent = matchState.minScore;
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
    $('#resTitle').textContent = `${list.length} matching heat user${list.length === 1 ? '' : 's'}`;
    const top = list.filter(u => u.score.total >= 60);
    $('#summary').innerHTML = `
      <div><b>${n0(list.reduce((a, u) => a + u.annualDemandMWh, 0))}</b><span>MWh/yr total demand</span></div>
      <div><b>${n0(site.supplyMWh)}</b><span>MWh/yr available</span></div>
      <div><b>${top.length}</b><span>strong matches (60+)</span></div>
      <div><b>${n0(Math.max(0, ...list.map(u => u.score.co2Tonnes)))}</b><span>t CO₂/yr, best single match</span></div>`;
    $('#mrows').innerHTML = list.map(u => `
      <tr class="clickable ${selected.has(u.id) ? 'selected' : ''}" data-id="${u.id}">
        <td><input type="checkbox" class="sel" ${selected.has(u.id) ? 'checked' : ''}></td>
        <td class="muted num">${u.rank}</td>
        <td class="co"><b>${esc(u.name)}</b>${u.publicSector ? ' <span class="tag">Public</span>' : ''}<div class="muted" style="font-size:12px">${esc(u.contact.name)} · ${esc(u.contact.role)}</div></td>
        <td>${esc(u.sectorLabel)}</td>
        <td class="r num">${n1(u.distanceKm)} km</td>
        <td class="r num">${n0(u.annualDemandMWh)} MWh</td>
        <td title="Energy ${u.score.energy} · Likelihood ${u.score.likelihood} · Feasibility ${u.score.feasibility}">${scoreBar(u.score.total)}</td>
        <td class="r num">${u.score.paybackYears > 40 ? '>40' : n1(u.score.paybackYears)} yrs</td>
        <td>${u.lead ? statusBadge(u.lead.status) : '<span class="muted">—</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="9" class="empty">No heat users match. Try a bigger radius or a lower minimum score.</td></tr>';
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
      if (u.score.total >= 60) layer.addLayer(L.polyline([[site.lat, site.lon], [u.lat, u.lon]], { color: css('--heat-500'), weight: 1, opacity: .35, interactive: false }));
    });
    if (fit) map.fitBounds(circle.getBounds(), { padding: [10, 10] });
    updateBar();
  }
  function updateBar() {
    $('#abar').hidden = selected.size === 0;
    $('#selInfo').innerHTML = `<b>${selected.size}</b> compan${selected.size === 1 ? 'y' : 'ies'} selected for outreach`;
  }
  function toggle(id, on) { on ? selected.add(id) : selected.delete(id); render(false); }

  function openUser(u) {
    const s = u.score;
    const sc = (label, v) => `<div class="mini"><span>${label}</span><div class="bar"><i style="width:${v}%;background:${scoreColor(v)}"></i></div><b class="num" style="text-align:right">${v}</b></div>`;
    openDrawer(`
      <div class="modal-head"><div><div class="muted" style="font-size:12px">#${u.rank} · ${esc(u.sectorLabel)}</div><h2>${esc(u.name)}</h2></div><button class="x" data-close>×</button></div>
      <div class="modal-body">
        <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px"><div style="font-size:40px;font-weight:800;color:${scoreColor(s.total)};line-height:1">${s.total}</div><div class="muted">Overall match score<br>${u.lead ? statusBadge(u.lead.status) : 'Not contacted yet'}</div></div>
        ${sc('Energy match', s.energy)}${sc('Contract likelihood', s.likelihood)}${sc('Feasibility &amp; cost', s.feasibility)}
        <h3 class="section-title">Business case (indicative)</h3>
        <dl class="kv">
          <dt>Heat deliverable</dt><dd>${n0(s.deliveredMWh)} MWh/yr</dd>
          <dt>Annual savings for customer</dt><dd>${eur(s.annualSavings)}</dd>
          <dt>CO₂ avoided</dt><dd>${n0(s.co2Tonnes)} t/yr</dd>
          <dt>Connection capex</dt><dd>${eur(s.capex)}</dd>
          <dt>Simple payback</dt><dd>${s.paybackYears > 40 ? '> 40' : n1(s.paybackYears)} years</dd>
          <dt>Temperature headroom</dt><dd>${s.tempGap > 0 ? '+' : ''}${s.tempGap} °C</dd>
        </dl>
        <h3 class="section-title">Profile</h3>
        <dl class="kv">
          <dt>Distance</dt><dd>${n1(u.distanceKm)} km</dd>
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
  ['we', 'wl', 'wf'].forEach(k => $('#' + k).oninput = e => { matchState[k] = +e.target.value; outputs(); debounced(false); });
  $('#sector').onchange = e => { matchState.sector = e.target.value; render(false); };
  $('#minScore').oninput = e => { matchState.minScore = +e.target.value; outputs(); render(false); };
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
  const vars = u => ({ company: u.name, contact_name: u.contact.name, site_name: site.name, city: site.city, distance: n1(u.distanceKm), supply_temp: site.supplyTempC,
    delivered_mwh: n0(u.score.deliveredMWh), savings: n0(u.score.annualSavings), co2: n0(u.score.co2Tonnes), payback: u.score.paybackYears, sender: $('#oSender')?.value || 'FT Heat Partnerships' });
  const fill = (t, v) => t.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in v ? esc(v[k]) : esc(m)));
  openModal(`
    <div class="modal-head"><h2>Send outreach to ${users.length} compan${users.length === 1 ? 'y' : 'ies'}</h2><button class="x" data-close>×</button></div>
    <div class="modal-body grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px">
      <div>
        <label class="field">Sender name<input type="text" id="oSender" value="FT Heat Partnerships"></label>
        <label class="field" style="margin-top:12px">Subject<input type="text" id="oSubj" value="${esc(META.template.subject)}"></label>
        <label class="field" style="margin-top:12px">Message template<textarea id="oBody" rows="14">${esc(META.template.body)}</textarea></label>
        <div style="margin-top:8px" class="muted">Click to insert a field:</div>
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
  <div class="page-head"><div><h1>Partnership pipeline</h1><p>Drag a card to update its status. Signed contracts show up on the global map.</p></div>
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
          <div class="f"><span class="tag">Score ${l.score}</span><span class="muted">${n0(l.deliveredMWh)} MWh · ${n1(l.distanceKm)} km</span></div></div>`).join('')}
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
  kb.addEventListener('click', e => { const c = e.target.closest('.kcard'); if (c) openLead(leads.find(l => l.id === c.dataset.id), upd => { const l = leads.find(x => x.id === upd.id); Object.assign(l, upd); render(); }); });
  render();
}

function openLead(l, done) {
  openDrawer(`
    <div class="modal-head"><div><div class="muted" style="font-size:12px">${esc(l.id)} · ${esc(l.sectorLabel)}</div><h2>${esc(l.userName)}</h2></div><button class="x" data-close>×</button></div>
    <div class="modal-body">
      <dl class="kv">
        <dt>Heat source</dt><dd><a href="#/site/${l.siteId}" data-close>${esc(l.siteName)}</a></dd>
        <dt>Distance</dt><dd>${n1(l.distanceKm)} km</dd>
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
    <div class="mail-list">${mails.map((m, i) => `<div class="mail-item" data-i="${i}"><div class="to"><span>${esc(m.company)}</span><span class="muted" style="font-weight:400;font-size:12px">${ago(m.at)}</span></div><div class="s">${esc(m.subject)}</div><div class="muted" style="font-size:12px">via ${esc(m.siteName)}</div></div>`).join('') || '<div class="empty">No emails sent yet.<br>Open an installation, select heat users and send outreach.</div>'}</div>
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
function showLogin(errorMsg) {
  SESSION = null; closeModal(); destroyMaps();
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
      SESSION = r.email;
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
