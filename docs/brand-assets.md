# Brand assets

What MENA One bundles for the brand (1.55), where each came from and on what terms. Nothing here is fetched at runtime: the app works offline.

## Fonts — `src/assets/fonts/`

From Fontsource 5.3.0 (npm), woff2, latin and latin-ext subsets. All under the SIL Open Font License 1.1 (texts beside the files).

| Family | Weights | Licence file |
|---|---|---|
| Saira SemiCondensed | 500, 600 | `OFL-Saira.txt` |
| IBM Plex Sans | 400, 500, 600 | `OFL-IBM-Plex.txt` |
| IBM Plex Mono | 500 | `OFL-IBM-Plex.txt` |

## MENA BIG — `src/assets/brand/`

The company's own marks and photograph, from the MENA BIG design system: `logo-primary.png`, `logo-white.png` (160 px), `office-band.jpg` (the office banner, cropped to leave out the logo).

## My Day's city photographs — `src/assets/band/`

One per office city (two for Riyadh and Dubai, shown on alternate days), 1600 × 600 webp. Picked with the owner (30-Sep-2026). The band's scrim keeps the greeting at 4.5:1 or more on each (`python3 scripts/band-contrast.py`).

| File | Place | Photographer | Source | Licence |
|---|---|---|---|---|
| `riyadh.webp` | Riyadh at night | سيف الظاهر (Saif Aldhaher, @saifaldhaher) | https://unsplash.com/photos/a-city-at-night-vAkHAP27QMk | Unsplash Licence |
| `riyadh-2.webp` | King Abdullah Financial District | Kolaiel | https://commons.wikimedia.org/wiki/File:KAFD_6.jpg | CC0 |
| `jeddah.webp` | Jeddah corniche | Suhrid (@suhriid) | https://unsplash.com/photos/a-beach-next-to-a-city-with-tall-buildings-Zfk19D5hmGc | Unsplash Licence |
| `dubai.webp` | Burj Khalifa and Downtown | Ahmed Aldaie (@ahmedaldaie) | https://unsplash.com/photos/burj-khalifa-skyline-in-dubai-aKj9uDanF18 | Unsplash Licence |
| `dubai-2.webp` | Dubai skyline at night | Robert Bock | https://commons.wikimedia.org/wiki/File:Dubai_skyline_unsplash.jpg | CC0 |
| `beirut.webp` | Zaitunay Bay at blue hour | rashid khreiss (@rush_intime) | https://unsplash.com/photos/brown-wooden-dock-near-body-of-water-at-night-Ur0JWjVvP60 | Unsplash Licence |
| `barcelona.webp` | Port Vell at blue hour | Jordi Vich Navarro (@jvich) | https://unsplash.com/photos/city-skyline-under-blue-sky-during-night-time-h0qUUgi2WZg | Unsplash Licence |

The Unsplash Licence allows free use without attribution; CC0 is public domain. Both are credited here anyway.
