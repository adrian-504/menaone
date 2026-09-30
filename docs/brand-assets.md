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

The company's own marks and photograph, from the MENA BIG design system: `logo-primary.png`, `logo-white.png` (the full lockup, 160 px), `mark-primary.png`, `mark-white.png` (the wordmark and the three bars without the subtitle, which is unreadable at sidebar size — the sidebar uses these), `office-band.jpg` (the office banner, cropped to leave out the logo).

## The app mark — `src-tauri/icons/`, `src/assets/brand/mark-tile.png`

The MENA "m" traced pixel-exact from `logo-primary.png` (its first letter), white on brand blue #014B8C, with the three coral bars in the letterhead mark's proportions. The app icon follows Apple's macOS grid (an 824 px continuous-corner squircle on a 1024 canvas; macOS doesn't round a bundle's icon itself), and its 16 and 32 px sizes are drawn on the pixel grid so the bars stay three lines. `python3 scripts/icon/make-icon.py <brand assets> <out>` makes the master, the small sizes and the sidebar tile; `npx tauri icon` the PNG set; the .icns and .ico are assembled from the hand-drawn small sizes.

## My Day's city photographs — `src/assets/band/`

One per office city (two for Riyadh, Dubai and Barcelona, shown on alternate days), 1600 × 600 webp. Picked with the owner (30-Sep-2026). The band's scrim keeps the greeting at 4.5:1 or more on each (`python3 scripts/band-contrast.py`).

| File | Place | Photographer | Source | Licence |
|---|---|---|---|---|
| `riyadh.webp` | Riyadh at night | سيف الظاهر (Saif Aldhaher, @saifaldhaher) | https://unsplash.com/photos/a-city-at-night-vAkHAP27QMk | Unsplash Licence |
| `riyadh-2.webp` | King Abdullah Financial District | Kolaiel | https://commons.wikimedia.org/wiki/File:KAFD_6.jpg | CC0 |
| `jeddah.webp` | Jeddah corniche | Suhrid (@suhriid) | https://unsplash.com/photos/a-beach-next-to-a-city-with-tall-buildings-Zfk19D5hmGc | Unsplash Licence |
| `dubai.webp` | Burj Khalifa and Downtown | Ahmed Aldaie (@ahmedaldaie) | https://unsplash.com/photos/burj-khalifa-skyline-in-dubai-aKj9uDanF18 | Unsplash Licence |
| `dubai-2.webp` | Dubai skyline at night | Robert Bock | https://commons.wikimedia.org/wiki/File:Dubai_skyline_unsplash.jpg | CC0 |
| `beirut.webp` | Zaitunay Bay at blue hour | rashid khreiss (@rush_intime) | https://unsplash.com/photos/brown-wooden-dock-near-body-of-water-at-night-Ur0JWjVvP60 | Unsplash Licence |
| `barcelona.webp` | Park Güell at dusk | Lief Peng (@liefpeng) | https://unsplash.com/photos/barcelona-at-dusk-seen-from-park-guell-W8tw8v0e0uM | Unsplash Licence |
| `barcelona-2.webp` | Las Arenas and the Eixample at night | Bohdan Nahorniak (@nanik00) | https://unsplash.com/photos/an-aerial-view-of-a-city-at-night-y9crmlkIHxk | Unsplash Licence |

The Unsplash Licence allows free use without attribution; CC0 is public domain. Both are credited here anyway.
