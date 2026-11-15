# Marswalk Planner · Jezero Crater

**NASA Space Apps Challenge: "Interplanetary Survival Guide: Martian Map"**

**Live site:** https://marswalk-map.netlify.app · **Code:** https://github.com/lordfire4455/marswalk-planner

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
| **Go / no-go checks** | Suit time and reserve, walkback on backup oxygen, suit oxygen, terrain, daylight, temperature, dust-storm season, radio line of sight to base, steep base or stops, one-way pickup. |
| **EVA numbers** | Distance, walking time, climb, metabolic energy, oxygen used, longest walkback, farthest point from base. |
| **Elevation profile** | Coloured by slope class, with a radio line-of-sight strip. Hover to find any point on the map. |
| **No-go zones** | Draw an area the crew must not cross (soft sand, boulders, a cliff edge); every route re-plans around it. |
| **Field reports** | Log a hazard, science find, resource, landmark or radio note with a confidence label (Measured, Observed, Estimated), author and Mars + Earth time. A hazard can keep routes 50 to 200 m away. Saved in the browser, the share link and the GeoJSON. |
| **Route comparison** | Safest, fastest and science-rich options side by side, drawn on the map, with one click to switch. |
| **Crew and oxygen** | Crew size and usable O₂ per suit, checked against the walk with a 25% reserve; a solo EVA is flagged. |
| **Key takeaway and trust labels** | One plain sentence per plan; every number tagged "NASA terrain", "Model" or "Your input"; a "How sure are we?" panel listing what was checked against NASA. |
| **Guided tour** | A 14-step, one-minute spotlight tour from the mission overview or the top bar. |
| **Mission overview** | An entrance screen that explains the project, shows live Jezero time, maps each challenge requirement to a feature, and jumps into any of the four views. |
| **Crew or machine?** | The same route scored 0–100 for a suited crew on foot and for an autonomous six-wheeled machine, each with a GO / CAUTION / NO-GO verdict, the limiting factor and a one-line recommendation (also in the briefing). |
| **3D preview** | The route draped over a solid block of real terrain, with a fly-through in which a suited astronaut (drawn larger than life so it stays visible) walks the route, leans into climbs and waves on arrival. An Astronaut / Machine switch swaps in a procedural rocker-bogie rover (turning wheels, scanning mast, arm that unstows on arrival); it starts on whichever option scored higher. |
| **Science targets** | 19 Perseverance sites (17 sample sites, the Three Forks sample depot and the landing site) plus two Ingenuity sites, all at their real surveyed positions. |
| **Why this route?** | For every leg: what the straight line runs into, how far the route bends to avoid it, and what it gave up against the quickest path the slope limit allows. Can be drawn on the map and is printed in the briefing. |
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
- `js/router.js`: A* route search with 16 directions of movement. Step cost is walking time multiplied by a slope hazard factor, the same factor at every slope limit (strong for "Safest", weak for "Fastest"). Cells inside no-go zones are impassable.
- `js/eva.js`: walking speed as a function of slope from Apollo 14 traverse data (Marquez 2008) and metabolic cost from Santee et al. (2001) at Mars gravity. These are the models used by the NASA / MIT SEXTANT traverse planner.
- `js/planner.js` also applies the Apollo walkback rule: from every point of the route, the walk to safety (retracing the route or carrying on to its end) plus the 15 min airlock time must fit inside the backup oxygen time.
- `js/mars-time.js`: Mars Sol Date, local solar time, solar longitude, sunrise and sunset (Allison & McEwen 2000, the algorithm behind NASA's Mars24).
- `js/conditions.js`, `js/planner.js`, `js/science.js`, `js/layers.js`, `js/briefing.js`, `js/view3d.js`: weather, planning, targets, map layers, briefing, 3D.
- `js/field.js`: no-go zones and field reports; burns zones into a mask over the elevation grid that the router treats as impassable.
- `js/tour.js`: the guided tour.
- `js/explain.js`: the *Why this route?* panel. It re-walks the straight line and runs the router once more with the slope penalty off (`hazardWeight: 0`) to compare against.
- `js/intro.js`: the mission overview (entrance screen). `js/app.js`: start-up, tabs, ready-made missions and the Data & methods window.
- `tools/build_data.py`: rebuilds everything in `data/` from the raw NASA files.

## Checked against NASA values

- The Mars clock reproduces the sol number and sunrise time in NASA's weather feeds (Perseverance sol 1127 on 2024-04-21, sunrise 06:13; Curiosity sol 4995 on 2026-08-25).
- The elevation model agrees with Perseverance's own localization at all 708 rover waypoints: mean difference 0.9 m, standard deviation 3.4 m.
- Sample-site positions are the rover waypoints for the sols on which each sample was collected.
- **Route choice, against Perseverance.** We cut the rover's real drive into 40 stretches of about 1 km (40.7 km in all) and gave the planner only each stretch's start and end. 79% of the planned route length lies within 100 m of the path JPL's drivers chose (median stretch 100%, median gap 44 m). Only 2.9% of the planned routes is on slopes over 15°, against 6.6% for the rover and 5.8% for straight lines, and none is over the 25° limit. Rebuild it with `node tools/validate_routes.js`; see it with the *Planner vs Perseverance* layer.

## Measured impact and science at each stop

- Every plan shows its own measured impact: the steep ground a straight-line walk would cross, the extra distance the safe route costs, science stops per EVA hour and the oxygen left per suit.
- At every stop and science target the app reads the MRO CRISM browse products (Viviano-Beck et al. 2014) and reports a relative band strength for carbonate, Fe/Mg clay, hydrated minerals, olivine, pyroxene and chlorite, with what each mineral means for the search for life. The images are baked into a 64 kB grid (`tools/build_minerals.py`), so this also works offline.

## Limits

- A 20 m grid cannot see individual rocks or sand ripples. Use the HiRISE layer to check the last metres by eye.
- Weather is a seasonal outlook, not a forecast. Outside the MEDA season the norms come from Curiosity at Gale Crater (4.6° S, much lower than Jezero), so pressure is scaled to Jezero with MEDA's own readings.
- The suit oxygen (600 g) and backup oxygen (60 min) defaults are planning placeholders, not real suit specs. Set them to your suit. Science stops count as light work (150 W), so the oxygen figure is a low estimate.
- The crew-or-machine scores are a planning heuristic. Crew: walkback, darkness, suit oxygen, suit time, an 8.5 km foot radius and slopes over 22° are hard limits; effort, steep ground, cold and thin margins take points off. Machine (`MM.eva.PROFILES.machine`): ground over 20° is a hard limit, over 14° caps the score below 40, slopes over 12° halve progress (wheel slip), and sharp crests, the sand ripples near Séítah and Observation Mountain, and the number of sols (about 180 m per sol) take points off. The 20 m elevation model cannot see rocks or ripples smaller than a pixel.
- Walkback time follows the planned route, so it is an upper bound on the walking time: a real shortcut could be quicker.
- Speed and energy models come from Apollo lunar data and are planning estimates, not flight rules.

## Working on it as a team

- Everything is plain HTML, CSS and JavaScript. There is no build step and nothing to install. Edit a file, reload the page.
- `index.html` loads the scripts in order. Each module adds itself to `window.MM` (for example `MM.planner`, `MM.terrain`).
- `data/*.js` are generated files. Change them by running `python tools/build_data.py <folder with the raw NASA files>`, not by hand.
- `vendor/` holds Leaflet, three.js and the two web fonts, so the app runs offline.
- Check a change in Chrome and on a phone-sized window (the layout changes below 900 px wide) before you push.

## Credits

Map library: [Leaflet](https://leafletjs.com) (BSD-2). 3D: [three.js](https://threejs.org) (MIT). Fonts: Space Grotesk and DM Sans (SIL Open Font License), bundled in `vendor/fonts/`. Overview globe: NASA Viking Orbiter colour mosaic (MDIM 2.1) via NASA Solar System Treks. Data courtesy NASA/JPL-Caltech, USGS Astrogeology, University of Arizona, JHU-APL, Arizona State University, MSSS, and CAB (CSIC-INTA). NASA does not endorse this project.
