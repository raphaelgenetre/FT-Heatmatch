# FT HeatMatch: MVP

A heat-matching platform that helps FT find businesses near its cremators that could buy their surplus heat.
All installations, companies, contacts and numbers are **fictional demo data**.

## Sign in

Use any **@alumni.esade.edu** email address with the shared password (ask the team). Change the rule in `lib/auth.js`.
In `HeatMatch.html` the check runs in the browser, so it keeps casual visitors out but is not real security. The server version (`node server.js`) checks it on the server.

## Easiest: no install

Double-click **`HeatMatch.html`**. It opens in your browser and everything runs inside that one file.
Your changes are saved in that browser. (Rebuild it after code changes with `python3 build-standalone.py`.)

## Run it as a local server

You need **Node.js 18 or newer** (https://nodejs.org). No `npm install` needed: the app has zero dependencies.

- **Mac:** double-click `start-mac.command`. If macOS blocks it, right-click → Open.
- **Windows:** double-click `start-windows.bat`.
- **Terminal:** run `node server.js`, then open http://localhost:3000

Stop it with `Ctrl + C`.

## What it does (mapped to the flip-chart)

| Flip-chart idea | Where in the app |
|---|---|
| Collect data from the crematorium | Installation page → **Update operating data** |
| Define search radius | Installation page → **Search radius** slider (1–30 km) |
| Identify and rank heat users (list and map view) | Installation page → ranked table + map, with **Map + list / List only** toggle |
| Ranking: energy needed / contract likelihood / technical feasibility and cost | Adjustable **ranking weights** and a per-company score breakdown with a business case |
| Manual oversight → select companies → send automatic email | Tick companies → **Send outreach email** → editable template with live preview |
| Update a global map of partnerships and spot patterns | **Global overview**: partnership map, sector win rates, win rate by distance, coverage by country |
| (extra) Track outcomes | **Partnership pipeline**: drag-and-drop Kanban, notes and history per lead |

## Demo data

- 1,000 FT cremators at 588 sites in 38 countries (~94% in Europe)
- 22–42 dummy heat users per site (greenhouses, pools, hospitals, schools, district heating and more)
- About 250 seeded partnership leads so the global map and pattern charts have content

Changes are saved to `data/state.json`. To start fresh, click **Reset demo** at the bottom of the sidebar.
Emails are **not actually sent**; they're logged in the **Outbox**.

## Brand colours

Colours are sampled from the FT logo: orange `#EE9637` and grey `#A1A6A9`.

Every colour lives in `public/theme.css`. Edit the hex codes there and refresh the browser.

## Scoring model (simplified)

- **Energy match:** how well the cremator's annual surplus matches the company's demand, and how much their demand overlaps cremator operating hours.
- **Contract likelihood:** sector base rate, plus bonuses for public sector (public support), sustainability commitments, an ageing boiler and fossil heating.
- **Feasibility and cost:** temperature headroom, pipe length (€450/m plus a €65k substation) and payback against €55/MWh heat.
- CO₂: 0.202 t per MWh of gas heat replaced.

## Working as a team

- `main` always holds a working demo. Make changes on a branch (`git checkout -b my-feature`), then open a pull request.
- Edit the source files in `public/`, `lib/` and `server.js`.
- **`HeatMatch.html` is generated:** after changing the source, run `python3 build-standalone.py` and commit the regenerated file too, so the double-click version stays up to date.

## Project structure

```
server.js              local server + API (Node, no dependencies)
lib/data.js            dummy data generator and scoring model
public/index.html      app shell
public/app.js          front-end (pages, map, matching, outreach, pipeline)
public/app.css         layout and components
public/theme.css       FT brand colours
public/vendor/         Leaflet map library + offline world outline
build-standalone.py    builds HeatMatch.html (single-file version)
HeatMatch.html         single-file version: double-click to open
```
