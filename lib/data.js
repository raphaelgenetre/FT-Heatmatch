// Deterministic dummy-data generator for the HeatMatch MVP.
// Everything here is fictional: installation names, companies, contacts and numbers.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];
const between = (r, a, b) => a + r() * (b - a);
const ibetween = (r, a, b) => Math.round(between(r, a, b));
function weighted(r, items) {
  const total = items.reduce((s, i) => s + i[1], 0);
  let x = r() * total;
  for (const [v, w] of items) { if ((x -= w) <= 0) return v; }
  return items[items.length - 1][0];
}

// [city, country code, lat, lon, weight]
const CITIES = [
  // United Kingdom
  ['London','GB',51.507,-0.128,22],['Birmingham','GB',52.486,-1.890,7],['Manchester','GB',53.481,-2.243,7],['Leeds','GB',53.800,-1.549,5],
  ['Glasgow','GB',55.864,-4.252,5],['Edinburgh','GB',55.953,-3.188,4],['Liverpool','GB',53.408,-2.991,4],['Bristol','GB',51.455,-2.588,4],
  ['Sheffield','GB',53.381,-1.470,3],['Newcastle','GB',54.978,-1.618,3],['Nottingham','GB',52.954,-1.158,3],['Cardiff','GB',51.481,-3.179,3],
  ['Belfast','GB',54.597,-5.930,3],['Southampton','GB',50.910,-1.404,2],['Leicester','GB',52.637,-1.140,2],['Norwich','GB',52.630,1.297,2],
  ['Plymouth','GB',50.376,-4.143,2],['Aberdeen','GB',57.149,-2.094,2],['Brighton','GB',50.823,-0.137,2],['Oxford','GB',51.752,-1.258,2],
  ['Cambridge','GB',52.205,0.122,2],['York','GB',53.960,-1.087,2],['Exeter','GB',50.718,-3.534,2],['Hull','GB',53.745,-0.336,2],
  // Netherlands
  ['Amsterdam','NL',52.370,4.895,6],['Rotterdam','NL',51.924,4.478,5],['The Hague','NL',52.078,4.288,5],['Utrecht','NL',52.091,5.122,4],
  ['Eindhoven','NL',51.441,5.470,3],['Groningen','NL',53.219,6.567,3],['Tilburg','NL',51.556,5.091,2],['Arnhem','NL',51.985,5.899,2],
  ['Nijmegen','NL',51.842,5.853,2],['Zwolle','NL',52.517,6.083,2],['Maastricht','NL',50.851,5.691,2],['Breda','NL',51.589,4.776,2],
  ['Leeuwarden','NL',53.201,5.800,1],['Enschede','NL',52.222,6.894,2],['Almere','NL',52.350,5.264,1],['Haarlem','NL',52.387,4.646,2],
  // Belgium
  ['Brussels','BE',50.850,4.352,4],['Antwerp','BE',51.219,4.402,3],['Ghent','BE',51.054,3.717,2],['Liège','BE',50.633,5.567,2],
  ['Bruges','BE',51.209,3.225,1],['Charleroi','BE',50.411,4.444,1],['Leuven','BE',50.880,4.700,1],
  // Germany
  ['Berlin','DE',52.520,13.405,6],['Hamburg','DE',53.551,9.994,4],['Munich','DE',48.137,11.576,4],['Cologne','DE',50.938,6.960,3],
  ['Frankfurt','DE',50.110,8.682,3],['Stuttgart','DE',48.776,9.183,3],['Düsseldorf','DE',51.228,6.774,2],['Dortmund','DE',51.514,7.468,2],
  ['Leipzig','DE',51.340,12.375,2],['Dresden','DE',51.050,13.738,2],['Hanover','DE',52.376,9.732,2],['Nuremberg','DE',49.452,11.077,2],
  ['Bremen','DE',53.079,8.802,2],['Kiel','DE',54.323,10.123,1],['Münster','DE',51.961,7.626,1],['Freiburg','DE',47.999,7.842,1],
  // France
  ['Paris','FR',48.857,2.352,5],['Lyon','FR',45.764,4.836,3],['Marseille','FR',43.296,5.370,3],['Lille','FR',50.629,3.057,2],
  ['Toulouse','FR',43.605,1.444,2],['Bordeaux','FR',44.838,-0.579,2],['Nantes','FR',47.218,-1.554,2],['Strasbourg','FR',48.573,7.752,2],
  ['Rennes','FR',48.117,-1.678,1],['Nice','FR',43.710,7.262,1],
  // Nordics
  ['Copenhagen','DK',55.676,12.568,3],['Aarhus','DK',56.163,10.204,2],['Odense','DK',55.403,10.402,1],
  ['Stockholm','SE',59.329,18.069,3],['Gothenburg','SE',57.709,11.975,2],['Malmö','SE',55.605,13.004,2],['Uppsala','SE',59.859,17.639,1],
  ['Oslo','NO',59.914,10.752,3],['Bergen','NO',60.393,5.322,1],['Trondheim','NO',63.431,10.395,1],
  ['Helsinki','FI',60.170,24.938,2],['Tampere','FI',61.498,23.761,1],['Turku','FI',60.452,22.267,1],
  ['Reykjavik','IS',64.147,-21.942,1],
  // Ireland
  ['Dublin','IE',53.350,-6.260,3],['Cork','IE',51.898,-8.475,1],['Galway','IE',53.271,-9.057,1],
  // Central / Southern / Eastern Europe
  ['Vienna','AT',48.208,16.373,3],['Graz','AT',47.071,15.439,1],['Linz','AT',48.306,14.286,1],
  ['Zurich','CH',47.377,8.541,2],['Geneva','CH',46.204,6.143,1],['Basel','CH',47.560,7.589,1],['Bern','CH',46.948,7.447,1],
  ['Prague','CZ',50.075,14.438,3],['Brno','CZ',49.195,16.607,2],['Ostrava','CZ',49.820,18.262,1],
  ['Warsaw','PL',52.230,21.012,2],['Kraków','PL',50.065,19.945,1],['Wrocław','PL',51.108,17.039,1],['Gdańsk','PL',54.352,18.646,1],
  ['Budapest','HU',47.498,19.040,2],['Bratislava','SK',48.149,17.107,1],['Ljubljana','SI',46.057,14.506,1],['Zagreb','HR',45.815,15.982,1],
  ['Milan','IT',45.464,9.190,2],['Rome','IT',41.903,12.496,2],['Turin','IT',45.070,7.687,1],['Bologna','IT',44.494,11.343,1],['Florence','IT',43.770,11.256,1],
  ['Madrid','ES',40.417,-3.704,2],['Barcelona','ES',41.385,2.173,2],['Valencia','ES',39.470,-0.376,1],['Seville','ES',37.389,-5.984,1],['Bilbao','ES',43.263,-2.935,1],
  ['Lisbon','PT',38.722,-9.139,1],['Porto','PT',41.158,-8.629,1],
  ['Luxembourg','LU',49.612,6.130,1],['Tallinn','EE',59.437,24.754,1],['Riga','LV',56.950,24.106,1],['Vilnius','LT',54.687,25.280,1],
  ['Bucharest','RO',44.427,26.103,1],['Athens','GR',37.984,23.728,1],['Sofia','BG',42.698,23.322,1],
  // Rest of world
  ['New York','US',40.713,-74.006,2],['Chicago','US',41.878,-87.630,1],['Toronto','CA',43.653,-79.383,1],['Montreal','CA',45.502,-73.567,1],
  ['Sydney','AU',-33.869,151.209,1],['Melbourne','AU',-37.814,144.963,1],['Auckland','NZ',-36.849,174.763,1],
  ['Tokyo','JP',35.676,139.650,1],['Singapore','SG',1.352,103.820,1],['Hong Kong','HK',22.320,114.169,1],['Seoul','KR',37.567,126.978,1],
  ['Johannesburg','ZA',-26.204,28.047,1],['Dubai','AE',25.205,55.271,1],['Mexico City','MX',19.433,-99.133,1],['São Paulo','BR',-23.551,-46.633,1],
];

const COUNTRY = {
  GB:'United Kingdom',NL:'Netherlands',BE:'Belgium',DE:'Germany',FR:'France',DK:'Denmark',SE:'Sweden',NO:'Norway',FI:'Finland',IS:'Iceland',
  IE:'Ireland',AT:'Austria',CH:'Switzerland',CZ:'Czechia',PL:'Poland',HU:'Hungary',SK:'Slovakia',SI:'Slovenia',HR:'Croatia',IT:'Italy',
  ES:'Spain',PT:'Portugal',LU:'Luxembourg',EE:'Estonia',LV:'Latvia',LT:'Lithuania',RO:'Romania',GR:'Greece',BG:'Bulgaria',
  US:'United States',CA:'Canada',AU:'Australia',NZ:'New Zealand',JP:'Japan',SG:'Singapore',HK:'Hong Kong',KR:'South Korea',ZA:'South Africa',
  AE:'United Arab Emirates',MX:'Mexico',BR:'Brazil',
};
const EUROPE = new Set(['GB','NL','BE','DE','FR','DK','SE','NO','FI','IS','IE','AT','CH','CZ','PL','HU','SK','SI','HR','IT','ES','PT','LU','EE','LV','LT','RO','GR','BG']);

const SITE_SUFFIX = ['Crematorium','Memorial Park Crematorium','Cemetery & Crematorium','Crematorium North','Crematorium South','Crematorium East','Crematorium West','Garden of Rest Crematorium','Municipal Crematorium','Woodland Crematorium'];
const MODELS = [['FT Classic',3],['FT Compact',2],['FT Hybrid',2],['FT Electric',1]];
const OPERATORS = ['Municipality','Private operator','Cooperative','Municipality','Funeral group'];

// Sector definitions: demand MWh/yr, required temperature, profile fit to cremator operating pattern, base contract likelihood.
const SECTORS = {
  greenhouse:   { label:'Greenhouse / horticulture', demand:[800,6000],  temp:[40,60], profile:0.72, base:0.62, publicP:0.0, w:3, nouns:['Greenhouses','Horticulture','Growers','Nurseries'] },
  pool:         { label:'Swimming pool / leisure',   demand:[400,2500],  temp:[28,40], profile:0.88, base:0.70, publicP:0.7, w:3, nouns:['Leisure Centre','Aquatic Centre','Swimming Pool','Lido'] },
  district:     { label:'District heating network',  demand:[2500,20000],temp:[65,90], profile:0.92, base:0.58, publicP:0.8, w:1, nouns:['District Heating','Heat Network','Warmtenet','Energy Co-op'] },
  care:         { label:'Hospital / care home',      demand:[700,5000],  temp:[55,80], profile:0.80, base:0.50, publicP:0.6, w:3, nouns:['Care Home','Hospital','Medical Centre','Hospice'] },
  education:    { label:'School / university',       demand:[200,1500],  temp:[50,70], profile:0.82, base:0.56, publicP:0.85,w:3, nouns:['Academy','College','School','Campus'] },
  office:       { label:'Office building',           demand:[150,900],   temp:[45,70], profile:0.80, base:0.38, publicP:0.15,w:4, nouns:['Business Park','Offices','Tower','House'] },
  laundry:      { label:'Industrial laundry',        demand:[300,1500],  temp:[55,80], profile:0.86, base:0.55, publicP:0.0, w:2, nouns:['Laundry Services','Textile Care','Linen Services'] },
  food:         { label:'Food processing',           demand:[500,4000],  temp:[60,90], profile:0.70, base:0.45, publicP:0.0, w:2, nouns:['Foods','Dairy','Bakery','Food Processing'] },
  brewery:      { label:'Brewery / distillery',      demand:[300,2000],  temp:[65,90], profile:0.62, base:0.50, publicP:0.0, w:1, nouns:['Brewery','Brewing Co.','Distillery'] },
  aquaculture:  { label:'Aquaculture',               demand:[300,2000],  temp:[22,35], profile:0.75, base:0.60, publicP:0.0, w:1, nouns:['Fish Farm','Aquaculture','Seafarms'] },
  housing:      { label:'Housing association',       demand:[500,4000],  temp:[55,70], profile:0.60, base:0.50, publicP:0.5, w:2, nouns:['Housing Association','Homes','Residential Trust'] },
  municipal:    { label:'Municipal building',        demand:[150,800],   temp:[50,70], profile:0.82, base:0.62, publicP:1.0, w:2, nouns:['Town Hall','Civic Centre','Public Library','Sports Hall'] },
};
const NAME_PREFIX = ['Meadow','Riverside','Oakridge','Northgate','Greenfield','Brookside','Highfield','Lakeside','Westbrook','Kingsway','Elmwood','Harbour',
  'Sunrise','Ashford','Stonebridge','Willow','Silverline','Bluewater','Fairview','Redhill','Pinecrest','Maple','Clearwater','Hillcrest','Beacon','Linden',
  'Polder','Dune','Heath','Orchard','Mill','Crown','Summit','Valley','Harvest','Evergreen','Northstar','Brightwell','Copperleaf','Foxglove'];
const FIRST = ['Anna','Mark','Sophie','Daan','Emma','Lukas','Olivia','James','Lotte','Pieter','Clara','Tom','Eva','Jan','Sarah','David','Maria','Peter','Julia','Ruben','Hanna','Thomas','Lisa','Noah'];
const LAST = ['de Vries','Smith','Jansen','Müller','Bakker','Brown','Visser','Schmidt','Dubois','Peeters','Taylor','Hansen','Nielsen','Andersson','Novak','Rossi','García','Wilson','Meijer','Fischer','Laurent','Janssens','Evans','Berg'];
const ROLES = ['Facilities Manager','Energy Manager','Sustainability Lead','Operations Director','Estates Manager','Managing Director'];

function slug(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function offset(lat, lon, km, bearing) {
  const R = 6371, d = km / R, b = bearing * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 * 180 / Math.PI, l2 * 180 / Math.PI];
}
function haversine(a, b, c, d) {
  const R = 6371, dLat = (c - a) * Math.PI / 180, dLon = (d - b) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- Cremator installations (1,000 cremator units in total) ----------
function generateSites() {
  const r = rng(20261120);
  const sites = [];
  const perCity = {};
  let units = 0, n = 0;
  while (units < 1000) {
    const [city, cc, lat, lon] = weighted(r, CITIES.map(c => [c, c[4]]));
    perCity[city] = (perCity[city] || 0) + 1;
    const spread = cc === 'GB' || cc === 'NL' || cc === 'DE' ? 45 : 35;
    const [la, lo] = offset(lat, lon, Math.sqrt(r()) * spread, r() * 360);
    let u = weighted(r, [[1, 45], [2, 40], [3, 15]]);
    u = Math.min(u, 1000 - units);
    units += u; n++;
    const model = weighted(r, MODELS);
    const kWPerUnit = model === 'FT Electric' ? ibetween(r, 110, 160) : ibetween(r, 160, 320);
    const hoursPerDay = ibetween(r, 7, 14);
    const daysPerWeek = weighted(r, [[5, 60], [6, 35], [7, 5]]);
    const cremations = Math.round(u * hoursPerDay * daysPerWeek * 52 / 1.6 * between(r, 0.55, 0.85));
    const placeName = perCity[city] === 1 ? city : `${pick(r, NAME_PREFIX)} (${city})`;
    const contact = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    sites.push({
      id: `CR-${String(n).padStart(4, '0')}`,
      name: `${placeName} ${perCity[city] === 1 ? 'Crematorium' : pick(r, SITE_SUFFIX)}`,
      city, country: cc, countryName: COUNTRY[cc], region: EUROPE.has(cc) ? 'Europe' : 'Rest of world',
      lat: +la.toFixed(5), lon: +lo.toFixed(5),
      units, model, installedYear: ibetween(r, 2003, 2025), operator: pick(r, OPERATORS),
      cremationsPerYear: cremations, hoursPerDay, daysPerWeek,
      recoverableKW: kWPerUnit * u, supplyTempC: model === 'FT Electric' ? ibetween(r, 65, 80) : ibetween(r, 80, 95),
      heatRecoveryInstalled: r() < 0.35,
      contact: { name: contact, role: 'Site Manager', email: `${slug(contact)}@${slug(city)}-crematorium.example` },
      lastServiceDate: new Date(Date.UTC(2025, ibetween(r, 0, 21), ibetween(r, 1, 28))).toISOString().slice(0, 10),
    });
    sites[sites.length - 1].units = u;
  }
  return sites;
}

function annualSupplyMWh(site) {
  // recoverable heat × operating hours × 70% average load factor
  return Math.round(site.recoverableKW * site.hoursPerDay * site.daysPerWeek * 52 * 0.7 / 1000);
}

// ---------- Heat users around a given installation ----------
function seedOf(id) { let h = 2166136261; for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const usersCache = new Map();
function heatUsersFor(site) {
  if (usersCache.has(site.id)) return usersCache.get(site.id);
  const r = rng(seedOf(site.id));
  const count = ibetween(r, 22, 42);
  const sectorKeys = Object.keys(SECTORS);
  const users = [];
  const usedNames = new Set();
  for (let i = 0; i < count; i++) {
    const key = weighted(r, sectorKeys.map(k => [k, SECTORS[k].w]));
    const s = SECTORS[key];
    const dist = Math.max(0.3, Math.pow(r(), 1.3) * 30);
    const [lat, lon] = offset(site.lat, site.lon, dist, r() * 360);
    let name;
    do { name = `${pick(r, NAME_PREFIX)} ${pick(r, s.nouns)}`; } while (usedNames.has(name));
    usedNames.add(name);
    const contact = `${pick(r, FIRST)} ${pick(r, LAST)}`;
    users.push({
      id: `${site.id}-HU${String(i + 1).padStart(2, '0')}`,
      name, sector: key, sectorLabel: s.label,
      lat: +lat.toFixed(5), lon: +lon.toFixed(5), distanceKm: +haversine(site.lat, site.lon, lat, lon).toFixed(2),
      annualDemandMWh: Math.round(between(r, s.demand[0], s.demand[1]) / 10) * 10,
      requiredTempC: ibetween(r, s.temp[0], s.temp[1]),
      profileFit: +Math.min(1, Math.max(0.2, s.profile + between(r, -0.15, 0.1))).toFixed(2),
      sustainability: weighted(r, [['None', 40], ['Net-zero target', 40], ['Certified (e.g. B Corp / ISO 50001)', 20]]),
      publicSector: r() < s.publicP,
      heatingSystemAge: ibetween(r, 1, 30),
      currentFuel: weighted(r, [['Natural gas', 65], ['Oil', 8], ['Electric / heat pump', 17], ['Biomass', 5], ['District heat', 5]]),
      contact: { name: contact, role: pick(r, ROLES), email: `${slug(contact)}@${slug(name)}.example`, phone: `+${ibetween(r, 31, 49)} ${ibetween(r, 10, 99)} ${ibetween(r, 100, 999)} ${ibetween(r, 1000, 9999)}` },
    });
  }
  usersCache.set(site.id, users);
  return users;
}

// ---------- Scoring ----------
const DEFAULT_WEIGHTS = { energy: 40, likelihood: 30, feasibility: 30 };
const ECON = { pipeCostPerM: 450, substationCost: 65000, heatPrice: 55, co2PerMWh: 0.202 };
function scoreUser(site, user, weights = DEFAULT_WEIGHTS) {
  const supply = annualSupplyMWh(site);
  const delivered = Math.min(supply, user.annualDemandMWh) * user.profileFit;
  const matchRatio = Math.min(supply, user.annualDemandMWh) / Math.max(supply, user.annualDemandMWh);
  const energy = 100 * (0.55 * Math.sqrt(matchRatio) + 0.45 * user.profileFit);

  let lk = SECTORS[user.sector].base;
  if (user.sustainability.startsWith('Certified')) lk += 0.2; else if (user.sustainability.startsWith('Net-zero')) lk += 0.1;
  if (user.publicSector) lk += 0.1;
  if (user.heatingSystemAge >= 15) lk += 0.1;
  if (user.currentFuel === 'Natural gas' || user.currentFuel === 'Oil') lk += 0.05;
  if (user.currentFuel === 'District heat') lk -= 0.15;
  const likelihood = 100 * Math.max(0.05, Math.min(1, lk));

  const tempGap = site.supplyTempC - user.requiredTempC; // °C of headroom
  const tempFactor = tempGap >= 10 ? 1 : tempGap >= 0 ? 0.7 + 0.03 * tempGap : Math.max(0.15, 0.7 + tempGap * 0.05);
  const capex = user.distanceKm * 1000 * ECON.pipeCostPerM + ECON.substationCost;
  const savings = delivered * ECON.heatPrice;
  const payback = savings > 0 ? capex / savings : 99;
  const feasibility = 100 * tempFactor / (1 + (payback / 12) ** 2);

  const wSum = weights.energy + weights.likelihood + weights.feasibility || 1;
  const total = (energy * weights.energy + likelihood * weights.likelihood + feasibility * weights.feasibility) / wSum;
  return {
    total: Math.round(total), energy: Math.round(energy), likelihood: Math.round(likelihood), feasibility: Math.round(feasibility),
    deliveredMWh: Math.round(delivered), capex: Math.round(capex / 1000) * 1000, annualSavings: Math.round(savings),
    paybackYears: +payback.toFixed(1), co2Tonnes: Math.round(delivered * ECON.co2PerMWh), tempGap,
  };
}

module.exports = { generateSites, heatUsersFor, scoreUser, annualSupplyMWh, SECTORS, COUNTRY, DEFAULT_WEIGHTS, ECON, rng, weighted, ibetween };
