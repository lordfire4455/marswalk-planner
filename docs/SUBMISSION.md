# Space Apps submission text

Copy each section into the matching field of the project page. Text in [brackets] is for the team to fill in.

## Project name

Marswalk Planner

## High-level summary

The first astronauts at Jezero Crater will have decades of NASA data about the ground under their boots, spread across a dozen archives and formats. Marswalk Planner puts it on one map and answers the question that matters before anyone opens the airlock: is this walk safe today, and what science can we do on the way? The crew picks a base and their science stops. The app finds the safest path over a real 20 m elevation model, avoiding slopes that are too steep, and returns a go / no-go with walking time, energy, oxygen, daylight, dust risk and radio cover, plus a printable EVA briefing and a 3D fly-through. It combines eleven datasets from six NASA missions and keeps working with no internet connection.

## Link to project demo

[30-second video or 7-slide deck link]

## Link to final project

https://marswalk-map.netlify.app and [code repository link]

## Detailed project description

**What it does.** Marswalk Planner is a web app for planning a walk on Mars. It has four parts.

1. *See the ground.* A slope hazard layer colours every 20 m cell of Jezero Crater from easy to no-go. It is computed in the browser from the Mars Reconnaissance Orbiter CTX stereo elevation model that was made for Perseverance's landing navigation. Underneath are 6 m CTX and 25 cm HiRISE images, sharp enough to show single boulders. Extra layers show CRISM mineral maps (olivine and pyroxene, carbonates, clays), Mars Odyssey night-time infrared, which separates firm rock from loose sand, and elevation contours.
2. *Pick your science.* Nineteen Perseverance sites are on the map at the positions the rover itself recorded: seventeen sample sites, the landing site and the Three Forks depot, where ten sealed sample tubes lie on the surface waiting to be picked up. Each has a short explanation of why it matters. Ingenuity's first airfield and final resting place are there too.
3. *Plan the walk.* The crew clicks a base and their stops. An A* search over 2.4 million terrain cells finds the path with the lowest walking time once steep ground is penalised (each step's time is multiplied by a slope penalty), staying under the chosen slope limit, usually in under half a second. It gives up a little time to keep the crew on gentler ground, and the *Why this route?* panel shows how much on every leg. The planner then suggests science targets within 600 m of the route and inserts them in the right order.
4. *Decide.* The summary gives a clear GO, GO WITH CAUTION or NO-GO with the reason for each check: suit time and reserve, the Apollo walkback rule (could the crew still get home on backup oxygen from every point?), suit oxygen, steep sections, daylight at Jezero for that date, expected temperature, dust-storm season, and how much of the route has radio line of sight to base. One click opens a printable EVA briefing with a timeline, elevation profile and science objectives. Another opens a 3D view that flies along the route.

**How it works.** Everything runs in the browser, with no server. The elevation model is packed into the app, so hazards and routes are computed on the device. Walking speed on slopes comes from Apollo 14 traverse data, and energy use from a published load-carriage model evaluated at Mars gravity. These are the same models used in SEXTANT, the traverse planner NASA and MIT built for analog missions. Mars local time, season, sunrise and sunset come from the algorithm behind NASA's Mars24 clock. Weather combines Perseverance MEDA reports from Jezero with seasonal norms from the full 14-year Curiosity REMS record.

**How we checked it.** The Mars clock reproduces the sol numbers and sunrise times in NASA's weather feeds. The elevation model agrees with Perseverance's own positions at all 708 rover waypoints, with a mean difference of 0.9 m.

**Benefits.** A crew, or mission control, gets one screen instead of a dozen archives. The same tool works for students and the public: anyone can plan a walk to the rock that may hold signs of ancient life and see what it would take. Because the data is bundled, it works where a Mars crew would use it: with no connection to Earth.

**What we would do next.** Add rock-abundance and sand-ripple hazards from HiRISE, live orbital dust maps, more landing sites, and a rover-plus-walk mode for longer trips.

**Tools and languages.** JavaScript, HTML and CSS; Leaflet for the map; three.js for 3D; Python (NumPy, tifffile, Pillow) to prepare the data.

## NASA data

- **Mars Reconnaissance Orbiter CTX**: Jezero stereo elevation model (20 m) and controlled 6 m orthomosaic, USGS Astrogeology, via NASA Solar System Treks. The elevation model drives the hazard map, routing, profiles, radio line of sight and 3D view.
- **MRO HiRISE**: Jezero controlled 25 cm orthomosaic, via NASA Solar System Treks. Used as the detailed base image.
- **MRO CRISM**: MTRDR mineral browse products for four targeted scenes, NASA Planetary Data System Geosciences Node. Used for the mineral layers.
- **Mars 2020 Perseverance**: traverse path, 708 localized waypoints, and MEDA weather reports, NASA/JPL-Caltech. Used for science-target positions, the rover track, validation of the elevation model, and Jezero weather.
- **Mars 2020 Ingenuity**: flight paths 1 to 72, NASA/JPL-Caltech.
- **Mars Science Laboratory Curiosity REMS**: 4,745 sols of weather reports, NASA/JPL-Caltech. Used for seasonal temperature, pressure, UV and sky norms.
- **Mars Odyssey THEMIS**: night-time infrared controlled mosaic, via NASA Solar System Treks.
- **Mars Global Surveyor MOLA** and **Viking Orbiter** mosaics, via NASA Solar System Treks, for regional context.

Full product IDs and links are in docs/DATA_SOURCES.md.

## Space agency partner and other data

- **ESA Mars Express HRSC**, part of the blended MOLA + HRSC relief map (USGS).
- **Centro de Astrobiología (CSIC-INTA), Spain**, which built and operates the MEDA and REMS weather stations with NASA.
- Open-source libraries: Leaflet (BSD-2) and three.js (MIT).

## References

See docs/DATA_SOURCES.md for the full list. Key methods: Allison & McEwen (2000) for Mars time; Horn (1981) for slope; Marquez (2008) and Santee et al. (2001) for walking speed and energy; Kass et al. (2016) for dust-storm seasons; Viviano-Beck et al. (2014) for CRISM products.

## Use of artificial intelligence

We used Anthropic's Claude as a coding assistant to help write and test the application code and to draft documentation. All data in the app comes from the NASA and partner sources listed above. No AI-generated images, video, audio or data are used in the project. [Edit this to match exactly how your team used AI, and add any other tools.]
