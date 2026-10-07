# universal-trip

Our family's guide for Universal Orlando, Oct 15–17, 2026: the day-by-day plan, live wait times with "go here next" suggestions, a park map with walking directions, food (including a Butterbeer passport) and hidden details for the kids to find.

Open it on a phone and use **Share → Add to Home Screen**. After the first load it works offline, except for live wait times.

## How it works

- Static site served by GitHub Pages. No build step for the app itself.
- Live waits come from the free [ThemeParks.wiki](https://themeparks.wiki) API, straight from the phone. If that fails, the app reads a backup copy that `.github/workflows/live-backup.yml` refreshes every ~10 minutes during the trip (branch `live-data`).
- Map tiles are © OpenStreetMap contributors.
- Ride, food and hunt data live in `data/src/`. After editing those files, run `python3 tools/build_data.py` to regenerate `data/app-data.json`.
- Progress (rides done, Express used, details found, Butterbeer tried) is saved on each phone.

Add `?now=2026-10-15T10:30` to the URL to preview a park day before the trip.
