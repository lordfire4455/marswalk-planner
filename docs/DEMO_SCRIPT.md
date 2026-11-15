# Demo script

## 30-second video

Record the screen at 1920 × 1080 with live imagery on. Lines in quotes are the voice-over.

| Time | On screen | Voice-over |
|---|---|---|
| 0–4 s | App opens on the mission overview: title, live Jezero clock, Perseverance's path drawing itself. | "The first astronauts on Mars will need the best map ever made." |
| 4–9 s | Click **Watch a demo mission**. The route draws itself; the profile appears. | "Marswalk Planner finds the safest path over real NASA terrain in under a second." |
| 9–14 s | Scroll the summary: GO WITH CAUTION verdict, time, energy, oxygen, walkback, radio. | "It checks time, energy, oxygen, daylight, dust and radio cover, and gives a clear go or no-go." |
| 14–19 s | Layers tab: switch on **Carbonates**, then zoom into HiRISE at Wildcat Ridge. | "Six NASA missions on one map: minerals from orbit, rocks at 25 centimetres." |
| 19–25 s | Click **3D preview**, then **Fly the route**. | "Preview the walk in 3D before you open the airlock." |
| 25–30 s | Open the EVA briefing. End on the title. | "Marswalk Planner. Walk safe. Do science. Come home." |

## Live pitch to judges (about 3 minutes)

1. **The problem (20 s).** NASA has mapped Jezero for decades with different instruments, in different archives and formats. An astronaut needs one answer: can I walk there safely today?
2. **Demo mission (40 s).** Start on the mission overview and point at the "Built to the challenge brief" row: one site, five kinds of NASA data, crew safety, science on the route. Then click *Watch a demo mission*. Explain the story: Perseverance left ten sample tubes on the ground at Three Forks. A crew could pick them up in one EVA. Show the route, the 5.2 km distance, the GO WITH CAUTION verdict and its two reasons: terrain blocks the radio line of sight to base for much of the walk, so a relay is needed; and from Three Forks the walk home plus the airlock takes about an hour, almost all of the backup oxygen, so the walkback margin is thin.
3. **It reacts to rules (30 s).** Change the slope limit to 15° on the *Bright Angel sortie* and watch the route move. Set the start time to 16:30 and show the NO-GO for darkness. Switch the date to June 2026 and show the dust-season caution.
4. **Science on the way (30 s).** Show *Science along the way* offering a nearby target and add it. Turn on the CRISM carbonate layer and point at the green ring along the crater margin: the "bathtub ring" of the ancient lake.
5. **Trust (30 s).** Open *Data & methods*. Eleven datasets, six missions. The clock matches NASA's sol numbers. The elevation model matches the rover's own positions at 708 waypoints (mean difference 0.9 m, standard deviation 3.4 m). Speed and energy models are the ones NASA and MIT use in SEXTANT.
6. **Works on Mars (20 s).** Turn off Wi-Fi and open the copy of the app saved on the laptop (`index.html`). Everything except the live imagery still works, because a crew on Mars cannot wait 20 minutes for a server on Earth.
7. **Close (10 s).** Open the EVA briefing and the 3D fly-through.

## Questions judges may ask

- **Is the data real?** Yes. Nothing is simulated. Every product ID is in docs/DATA_SOURCES.md.
- **How accurate is the route?** As good as a 20 m elevation model allows. It avoids steep ground but cannot see single rocks, so the HiRISE layer is there for a visual check.
- **Why Curiosity weather for Jezero?** Perseverance's public weather feed holds only one week of reports, the latest from April 2024. Curiosity has the longest weather record on Mars (14 years), so it gives the best seasonal norm, but it is a stand-in: Gale is at 4.6° S and Jezero at 18.4° N. Gale also lies much lower, so the app scales its pressure to Jezero using MEDA's readings. When MEDA data exists for the same season, the app uses it directly.
- **What is new here?** NASA's Mars Trek shows layers. This tool makes a decision from them: a route, a verdict and a briefing.
