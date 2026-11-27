# HeatMatch: how the back end works

## 1. The big picture

```
 Browser (the app you see)          Back end (server.js)                     Storage
 ─────────────────────────          ─────────────────────────────────        ───────────────────
 public/app.js  ──HTTP/JSON──▶      /api/login, /api/sites, /api/matches ──▶  data/state.json
 (pages, map, forms)                sign-in · matching · scoring · pipeline   (pipeline, emails,
                                    lib/data.js  (data + scoring model)        site edits, audit log)
                                    lib/auth.js  (sign-in rules)
```

- The **front end** (what users see) only displays data and sends requests.
- The **back end** holds the logic: who may sign in, which businesses are within range, how they are scored, and what happened to each deal.
- The two talk through a small **API**: one web address per action, exchanging JSON.

## 2. What each part does

| Part | File | Job |
|---|---|---|
| Web server and API | `server.js` | Serves the app, checks every request is signed in, answers the API |
| Data and scoring model | `lib/data.js` | Generates the 1,000 demo cremators and nearby businesses; scores each match |
| Sign-in rules | `lib/auth.js` | `@alumni.esade.edu` email + password (stored only as a hash) |
| Single-file build | `build-standalone.py` → `HeatMatch.html` | Packs the same back-end logic into the page so it runs with no server (used for GitHub Pages) |
| Tests | `test/api.test.js` | 10 automated checks, run with `npm test` |

## 3. The API

| Address | What it does |
|---|---|
| `POST /api/login` · `POST /api/logout` · `GET /api/session` | Sign in, sign out, who am I |
| `GET /api/sites` · `GET /api/sites/:id` | List crematoria / one crematorium |
| `PUT /api/sites/:id` | Update a site's operating data (validated ranges) |
| `GET /api/sites/:id/matches?radius=0.5` | Businesses within the radius, scored and ranked |
| `POST /api/outreach` | Send personalised emails (max 50 at once) and create leads |
| `GET /api/leads` · `PATCH /api/leads/:id` | Pipeline: list deals, move a deal, add a note |
| `GET /api/stats` | Numbers for the overview page and pattern charts |
| `GET /api/health` | "Is the server alive?" for hosting platforms |

## 4. The matching model

- **Radius:** 1 km maximum, 500 m recommended. Insulated hot-water pipe costs ≈ €900 per metre in a city and loses heat along the way. Within 500 m a connection typically pays back in under 10 years; past 1 km it rarely does.
- **Score (0–100)** = weighted mix of three sub-scores:
  - **Heat demand fit:** how much of our heat they can use, and whether they need it when the cremators run (weekdays, daytime).
  - **Chance of signing:** sector, public body, sustainability commitments, age of their boiler, current fuel.
  - **Cost to connect:** temperature fit, pipe length, payback time (pipe + €65k substation vs. heat saved at €65/MWh).
- CO₂ saved = MWh delivered × 0.202 t (gas heating replaced).

## 5. Environmental impact

Shown on the overview (today / if the pipeline signs / full potential), on each crematorium ("if the 5 best sign") and per company.

| Step | Assumption |
|---|---|
| Recovered heat replaces a gas boiler | Boiler efficiency 90%: 1 MWh of heat saves 1.11 MWh of gas |
| CO₂ avoided | 0.202 t CO₂ per MWh of gas burned |
| Gas saved (m³) | 10.55 kWh per m³ of natural gas |
| "Homes heated" | 12 MWh of heat a year per average European home |
| "Cars off the road" | 1.5 t CO₂ a year per average European car (~12,000 km) |
| Money saved | Heat valued at €65/MWh |

Formula: `CO₂ (t) = heat (MWh) ÷ 0.9 × 0.202`. All constants live in `lib/data.js` (`ECON`), so FT can replace them with its own figures. Not yet counted: the electricity used by the circulation pumps (small, about 1–2% of the heat delivered).

## 6. Security in the prototype

| Measure | Why |
|---|---|
| Sign-in required for all data | Contact details are personal data (GDPR) |
| Password stored only as a salted, stretched SHA-256 hash | Reading the code does not reveal the password |
| Session cookie: random token, `HttpOnly`, `SameSite=Strict`, expires on browser close / after 8 h idle | Scripts can't steal it, other sites can't use it, forgotten laptops time out |
| Max 5 wrong passwords per 15 min per IP | Stops password-guessing robots |
| Security headers (CSP, no framing, no sniffing) | Blocks common web attacks (injected scripts, click-jacking) |
| Input limits (100 KB requests, 50 recipients, validated ranges) | Bad or malicious input can't crash or flood the system |
| Audit trail (`by` on every change and email) | We know who did what, when |
| Crash-safe saving (write, then atomic rename) | A crash can't corrupt the data file |

**Known limit:** the GitHub Pages version runs entirely in the browser. Its sign-in keeps casual visitors out, but a technical user could bypass it. Real protection needs the server version, or a gate in front of the site (see below).

## 7. What production with FT would look like

| Area | Prototype | Production |
|---|---|---|
| Sign-in | Shared password | FT's own Microsoft accounts via **Microsoft Entra ID single sign-on**, with MFA and roles (viewer / sales / admin) |
| Hosting | GitHub Pages / laptop | **Azure App Service** in an EU region (FT likely already uses Microsoft 365), or **Cloudflare Pages + Workers** with **Cloudflare Access** in front |
| Database | One JSON file | **PostgreSQL** (Azure Database for PostgreSQL) with daily backups; PostGIS for "within 500 m" searches |
| Cremator data | Generated | Live data from FT's cremator control systems (operating hours, heat output, temperatures) via its remote-monitoring link |
| Business data | Generated | Business registers (e.g. Companies House UK, KvK NL), OpenStreetMap buildings, EU heat-demand maps (Hotmaps) |
| Email | Logged only | Microsoft Graph (send from FT mailboxes) or SendGrid, with unsubscribe links and bounce handling |
| Privacy | Demo data | GDPR: legitimate-interest basis for B2B outreach, opt-out, data kept in the EU, retention limits |
| Quality | `npm test` | Tests run automatically on every pull request (GitHub Actions), staging before production, monitoring and alerts |
