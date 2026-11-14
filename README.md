# Marswalk Planner · Jezero Crater

**NASA Space Apps Challenge: "Interplanetary Survival Guide: Martian Map"**

**Live site:** https://marswalk-map.netlify.app

A layered map of Jezero Crater that turns data from six NASA missions into one decision: **can a crew safely walk this route today, and what science can they do on the way?**

Pick a base, click your science stops, and the planner finds the safest path over a real 20 m elevation model, then gives a go / no-go with time, energy, oxygen, daylight, dust risk and radio cover.

## Run it

No build step and no server needed.

1. Open `index.html` in Chrome, Edge, Firefox or Safari.
2. The mission overview opens first. Click **Watch a demo mission**, or pick one of the four section cards to open the planner on that view. The **Mission overview** button in the top bar brings this screen back at any time.

With internet you get live NASA imagery (6 m CTX and 25 cm HiRISE). Without internet the app switches to its bundled terrain map, and routing, hazards, minerals, science targets and weather all still work.

For development, serve the folder so the browser can fetch NASA's live weather feed:

```
python -m http.server 8000
```

then open http://localhost:8000.

## What it does

| Feature | What the explorer gets |
|---|---|
| **Slope hazard map** | Every 20 m cell coloured from easy (under 5°) to no-go, computed from the MRO CTX stereo elevation model. |
| **Safest-route finder** | A* search over 2.4 million terrain cells. Avoids slopes above your limit and prefers gentle ground. Usually answers in under half a second. |
| **Go / no-go checks** | Suit time and reserve, terrain, daylight, temperature, dust-storm season, radio line of sight to base, one-way pickup. |
| **EVA numbers** | Distance, walking time, climb, metabolic energy, oxygen used, farthest point from base. |
| **Elevation profile** | Coloured by slope class, with a radio line-of-sight strip. Hover to find any point on the map. |
| **Mission overview** | An entrance screen that explains the project, shows live Jezero time, maps each challenge requirement to a feature, and jumps into any of the four views. |
| **3D preview** | The route draped over a solid block of real terrain, with a fly-through. |
| **Science targets** | 19 Perseverance sites (17 sample sites, the Three Forks sample depot and the landing site) plus two Ingenuity sites, all at their real surveyed positions. |
| **Science along the way** | Suggests targets within 600 m of your route and inserts them in the right order. |
| **Mineral maps** | CRISM olivine / pyroxene, carbonate and clay maps from orbit. |
| **Mars clock and weather** | Live Jezero local time, sol, season, sunrise and sunset; Perseverance MEDA reports; seasonal norms from 4,745 sols of Curiosity REMS data. |
| **EVA briefing** | One printable page with the timeline, checks, profile and science objectives. |
| **Share and export** | The plan is stored in the link; export the route as GeoJSON. |

## Data

Eleven published datasets from six NASA missions. See [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) for every product ID and URL.

- **Mars Reconnaissance Orbiter**: CTX elevation model and 6 m mosaic, HiRISE 25 cm mosaic, CRISM mineral maps
- **Mars 2020**: Perseverance traverse and sample-site positions, MEDA weather, Ingenuity flight paths
- **Mars Science Laboratory**: Curiosity REMS weather record (2012 to 2026)
- **Mars Odyssey**: THEMIS night-time infrared
- **Mars Global Surveyor**: MOLA topography (blended with ESA Mars Express HRSC)
- **Viking Orbiters**: global colour mosaic

## How it works

- `js/terrain.js`: unpacks the elevation model, computes slope (Horn's method) and shaded relief, samples elevation, checks line of sight including the curvature of Mars.
- `js/router.js`: A* route search with 16 directions of movement. Step cost is walking time multiplied by a slope hazard factor.
- `js/eva.js`: walking speed as a function of slope from Apollo 14 traverse data (Marquez 2008) and metabolic cost from Santee et al. (2001) at Mars gravity. These are the models used by the NASA / MIT SEXTANT traverse planner.
- `js/mars-time.js`: Mars Sol Date, local solar time, solar longitude, sunrise and sunset (Allison & McEwen 2000, the algorithm behind NASA's Mars24).
- `js/conditions.js`, `js/planner.js`, `js/science.js`, `js/layers.js`, `js/briefing.js`, `js/view3d.js`: weather, planning, targets, map layers, briefing, 3D.
- `js/intro.js`: the mission overview (entrance screen). `js/app.js`: start-up, tabs, ready-made missions and the Data & methods window.
- `tools/build_data.py`: rebuilds everything in `data/` from the raw NASA files.

## Checked against NASA values

- The Mars clock reproduces the sol number and sunrise time in NASA's weather feeds (Perseverance sol 1127 on 2024-04-21, sunrise 06:13; Curiosity sol 4995 on 2026-08-25).
- The elevation model agrees with Perseverance's own localization at all 708 rover waypoints: mean difference 0.9 m, standard deviation 3.4 m.
- Sample-site positions are the rover waypoints for the sols on which each sample was collected.

## Limits

- A 20 m grid cannot see individual rocks or sand ripples. Use the HiRISE layer to check the last metres by eye.
- Weather is a seasonal outlook, not a forecast.
- Speed and energy models come from Apollo lunar data and are planning estimates, not flight rules.

## Working on it as a team

- Everything is plain HTML, CSS and JavaScript. There is no build step and nothing to install. Edit a file, reload the page.
- `index.html` loads the scripts in order. Each module adds itself to `window.MM` (for example `MM.planner`, `MM.terrain`).
- `data/*.js` are generated files. Change them by running `python tools/build_data.py <folder with the raw NASA files>`, not by hand.
- `vendor/` holds Leaflet and three.js, so the app runs offline.
- Check a change in Chrome and on a phone-sized window (the layout changes below 900 px wide) before you push.

## Credits

Map library: [Leaflet](https://leafletjs.com) (BSD-2). 3D: [three.js](https://threejs.org) (MIT). Data courtesy NASA/JPL-Caltech, USGS Astrogeology, University of Arizona, JHU-APL, Arizona State University, MSSS, and CAB (CSIC-INTA). NASA does not endorse this project.
