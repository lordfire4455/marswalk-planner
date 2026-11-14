# Data sources

All data is public and was downloaded on 12 November 2026. Raw files go in a folder (for example `raw/`) and `python tools/build_data.py raw` rebuilds `data/`.

## Bundled with the app

| File in `raw/` | Mission · instrument | Product | Source |
|---|---|---|---|
| `mmap_jezero_ctx_dem_20m.tif` | MRO · CTX stereo | `JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0`, 1596 × 1512 cells at 20 m, heights relative to the MOLA areoid. Made by USGS Astrogeology for Mars 2020 Terrain Relative Navigation. | `https://trek.nasa.gov/mars/TrekWS/rest/cat/data/stream?label=JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0` |
| `mmap_m20_traverse.json` | Mars 2020 Perseverance | Traverse path to sol 2022 | `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json` |
| `mmap_m20_waypoints.json` | Mars 2020 Perseverance | 708 localized waypoints with elevation | `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json` |
| `mmap_m20_heli_path.json` | Mars 2020 Ingenuity | Flight paths 1 to 72 | `https://mars.nasa.gov/mmgis-maps/M20/Layers/json/m20_heli_flight_path.json` |
| `mmap_wx_m20.json` | Perseverance · MEDA | Daily weather reports | `https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json` |
| `mmap_wx_msl.json` | Curiosity · REMS | 4,745 sols, 2012-08-07 to 2026-08-25 | `https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json` |
| `mmap_crism_<scene>_07_br{maf,car,pfm}j_mtr3.png` | MRO · CRISM | MTRDR browse products for scenes HRL000040FF, FRT00005850, FRT00005C5E, FRT000066A4 (all 2007) | `https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/mrocr_4001/browse/2007/` then `2007_029/hrl000040ff/`, `2007_111/frt00005850/`, `2007_139/frt00005c5e/`, `2007_178/frt000066a4/` |

CRISM image bounds come from the `.lbl` file next to each product (`MINIMUM_LATITUDE`, `MAXIMUM_LATITUDE`, `WESTERNMOST_LONGITUDE`, `EASTERNMOST_LONGITUDE`).

## Streamed live from NASA Solar System Treks

Tile pattern: `https://trek.nasa.gov/tiles/Mars/EQ/<ID>/1.0.0/default/default028mm/{z}/{y}/{x}.<ext>` (equirectangular, 2 × 1 tiles at zoom 0).

| Layer | Mission · instrument | Trek ID | Max zoom |
|---|---|---|---|
| Imagery 6 m | MRO · CTX | `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` (png) | 13 |
| Imagery 25 cm | MRO · HiRISE | `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` (png) | 17 |
| Regional imagery | MRO · CTX | `Jezero_CTX_BlockAdj_dd` (png) | 12 |
| Night-time infrared | Mars Odyssey · THEMIS | `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` (png) | 9 |
| Colour relief | MGS · MOLA with Mars Express · HRSC | `Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw` (jpg) | 8 |
| Global colour | Viking Orbiters | `Mars_Viking_MDIM21_ClrMosaic_global_232m` (jpg) | 7 |

## Space agency partner data

- **ESA Mars Express HRSC** is part of the MOLA + HRSC blended relief (USGS).
- **MEDA and REMS** were built and are operated by Spain's Centro de Astrobiología (CSIC-INTA) with NASA/JPL.

## References

- Allison, M. & McEwen, M. (2000). A post-Pathfinder evaluation of areocentric solar coordinates with improved timing recipes for Mars seasonal/diurnal climate studies. *Planetary and Space Science* 48.
- Fergason, R. L. et al. (2020). Mars 2020 Terrain Relative Navigation flight product generation: digital terrain model and orthorectified image mosaics. *LPSC 51*.
- Horn, B. K. P. (1981). Hill shading and the reflectance map. *Proceedings of the IEEE* 69.
- Kass, D. M. et al. (2016). Interannual similarity in the Martian atmosphere during the dust storm season. *Geophysical Research Letters* 43.
- Marquez, J. J. (2008). Human-automation collaboration: decision support for lunar and planetary exploration. PhD thesis, MIT.
- Santee, W. R. et al. (2001). A proposed model for load carriage on sloped terrain. *Aviation, Space, and Environmental Medicine* 72.
- Viviano-Beck, C. E. et al. (2014). Revised CRISM spectral parameters and summary products. *JGR Planets* 119.
- Norheim, J. et al. (2018). Architecture of a surface exploration traverse analysis and navigational tool (SEXTANT). *IEEE Aerospace Conference*.
