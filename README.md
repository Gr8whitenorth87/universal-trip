# universal-trip

Our family's guide for Universal Orlando, Oct 15–17, 2026: the day-by-day plan, live wait times with "go here next" suggestions, a park map with walking directions, food (including a Butterbeer passport) and hidden details for the kids to find.

Open it on a phone and use **Share → Add to Home Screen**. After the first load it works offline, except for live wait times.

## How it works

- Static site served by GitHub Pages. No build step for the app itself.
- Live waits come from the free [ThemeParks.wiki](https://themeparks.wiki) API, straight from the phone. If that fails, the app reads a backup copy that `.github/workflows/live-backup.yml` refreshes every ~10 minutes during the trip (branch `live-data`).
- Map tiles are © OpenStreetMap contributors.
- The site is password-protected: everything the app shows is in `data/app-data.enc.json`, encrypted with the family password. Each phone asks once, then remembers.
- Research data (rides, food, hunts) lives in `data/src/`. The family's own plan, dining and birthday files are in `data/src/private/`, which is not committed; an encrypted copy is kept in `data/src/private.enc.json`. Rebuild with `TRIP_PASSWORD=... python3 tools/build_data.py`.
- Progress (rides done, Express used, details found, Butterbeer tried) is saved on each phone.

Add `?now=2026-10-15T10:30` to the URL to preview a park day before the trip.
