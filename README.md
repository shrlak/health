# Health Dashboard

A personal dashboard for Apple Health and Whoop data. One web app that works on
a laptop and a phone, with the data stored in your own Supabase project.

## What it shows

The layout follows the structure reported for Apple's redesigned Health app:
an **Insights** tab with a daily readiness score, a **Longevity** tab scoring
health categories, and category-shaped detail tabs underneath.

| Tab | Contents |
|---|---|
| **Insights** | A 0-10 readiness score labelled *Recover / Pace Yourself / Ready / Go For It*, the inputs that produced it, recent averages, and a feed of comparisons against your own baseline |
| **Longevity** | Heart, sleep, movement, metabolic, mental wellbeing, hearing and nutrition, each scored 0-100 with the inputs it used |
| **Sleep** | Stage breakdown, duration, efficiency, bedtime consistency, and a daytime-vs-night comparison |
| **Heart** | Recovery score by zone, HRV and resting heart rate against 7-day baselines, respiratory rate, skin temperature, and sleep-vs-recovery correlation |
| **Move** | Day strain, time by activity, heart-rate zones, strain-vs-next-day-recovery, recent workouts, plus steps, energy, distance, VO2 max and an explorer for every other metric in your export |

### About the scores

The readiness score and the Longevity category scores are computed here, not by
Apple. Each is a plain weighted blend of measured values against healthy
reference ranges and your own 30-day baseline, and each one shows the inputs it
actually used — a signal that is missing shifts weight to the others rather
than silently scoring zero. They are a way to watch change over time, not a
medical assessment.

The Insights feed is rule-based rather than model-generated: every entry is a
comparison of your last week against the three before it, and appears only when
the data supports it.

### The overnight-shift view

The Sleep tab splits your nights into **daytime sleep** and **normal nights** and
compares duration, efficiency, stage shares, next-day recovery, HRV and resting
heart rate across the two.

Nothing is logged by hand. A sleep whose midpoint falls between 09:00 and 20:00
is treated as daytime recovery sleep — the shape overnight shift work leaves in
the data — so the split comes straight from timings the wearable already
recorded.

## Getting your data in

Neither source syncs automatically yet; both start as file imports.

**Apple Health** has no public cloud API. The only way out is the export:

1. Open **Health** on your iPhone
2. Tap your photo, top right
3. Scroll down and tap **Export All Health Data**
4. Save the zip and choose it on the Import tab

**Whoop** does have a developer API (wired up in phase 2, below). For now:

1. Open **Whoop** → **Settings** → **Data Export**
2. Tap **Download my data**; Whoop emails you a zip of CSVs
3. Choose the zip — or any single CSV — on the Import tab

Imports are idempotent. Re-importing a newer export updates the days it covers
and leaves everything else alone, so the usual rhythm is to re-export every few
weeks.

### Why the import happens in your browser

`export.xml` inside an Apple Health zip is frequently several gigabytes and tens
of millions of samples. Rather than upload that, the app:

1. streams the zip through an inflater in a Web Worker, so the tab stays responsive
2. scans each chunk for complete XML elements, never holding the whole file
3. rolls records up to **one value per day per metric**, using the right rule for
   each (steps sum, heart rate averages, VO2 max takes the max)
4. uploads only those daily rows — thousands, not millions

Ten years of Apple Health lands as a few thousand rows.

## Setup

```bash
npm install
cp .env.example .env    # already filled in for the project created for you
npm run dev
```

Create an account on first load. If Supabase is set to confirm email addresses,
you will get a confirmation link before the first sign-in works.

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build into `dist/` |
| `npm test` | Parser and analytics checks against synthetic exports |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | oxlint |
| `npm run harness` | Builds `dist-harness/`, a local page that renders every view against generated data — useful for checking layout and dark mode without importing anything |

`npm run build` writes to `dist/`. Set `VITE_BASE` to serve from a subpath
(`VITE_BASE=/health/ npm run build`); it defaults to `/` for local dev and any
root-served host.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to the
default branch, and can be run by hand from the Actions tab.

**One-time setup:** in the repository, go to **Settings → Pages** and set
**Source** to **GitHub Actions**. That is the only manual step; nothing else
needs configuring.

The site then lands at `https://<your-username>.github.io/health/`.

A few things the workflow handles that catch people out:

- A project site is served from `/<repo>/`, not from the root, so the build
  needs `base` set or every asset 404s. The workflow derives it from the
  repository name, so renaming the repo does not break it.
- The same prefix applies to the import Web Worker, which Vite rewrites
  automatically once `base` is right.
- It drops a `.nojekyll` file, so Pages serves the output as-is instead of
  running it through Jekyll.
- It runs the typecheck and the parser tests before building, so a broken
  commit fails in CI rather than replacing a working site.

### Environment variables

The Supabase URL and publishable key are inlined at build time. The workflow
falls back to this project's values, so it deploys with no setup. To point a
fork at a different Supabase project, add repository **variables** (Settings →
Secrets and variables → Actions → Variables) named `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`; they take precedence.

These belong in variables rather than secrets because they are public by
design — a publishable key identifies the project and nothing more, and anyone
can read it out of the deployed bundle regardless. Row Level Security is what
protects the data.

### Close sign-ups once you have an account

**Worth doing before you share the URL.** A Pages site is public, and Supabase
allows anyone to register by default — so a stranger who finds the link could
create an account in your project. Row Level Security means they would see
none of your data, but they would still land in your auth table and count
against your quota.

Once you have signed in for the first time, turn registration off: Supabase
dashboard → **Authentication → Sign In / Providers → Email**, and disable
**Allow new users to sign up**. Your existing session keeps working.

### Adding it to a phone home screen

Open the deployed URL in Safari and choose **Add to Home Screen**. It opens
full-screen, without browser chrome.

## Data model

Five tables, all with `user_id`-scoped RLS:

- **`daily_metrics`** — long format (`day`, `metric`, `source`, `value`, `unit`).
  Apple Health's metric vocabulary grows with every watchOS release, so new
  metrics land as new rows rather than new columns.
- **`sleep_sessions`** — one row per sleep, with stage minutes, efficiency,
  latency, debt. Apple emits a record per stage interval; the parser stitches
  them into sessions, splitting on gaps over an hour.
- **`recovery`** — recovery score, HRV, resting heart rate, SpO2, skin temperature.
- **`cycles`** — Whoop day strain, average and max heart rate, energy.
- **`workouts`** — one row per session with duration, energy, distance, heart
  rate and Whoop's per-zone minutes.

Where both wearables report the same thing, Whoop wins for recovery, HRV and
sleep staging, and Apple wins for step counts and anything phone-derived. The
same workout logged by both is collapsed into one, keeping whichever record is
better instrumented and filling its gaps from the other.

Units are normalised on the way in. Apple exports in the locale's units, so the
same metric can arrive as miles or kilometres, pounds or kilograms, °F or °C.

Timestamps keep the offset that was in effect when the sample was recorded, so
days stay correct across travel and daylight saving.

## Phase 2: automatic Whoop sync

The schema has a `whoop_tokens` table ready for it. To finish the wiring:

1. Register an app at [developer.whoop.com](https://developer.whoop.com) and set
   the redirect URI to your deployed URL
2. Put the client ID and secret in a Supabase Edge Function — never in the
   frontend, since the secret must not ship to the browser
3. Have the function run the OAuth exchange, store the tokens, and pull
   `/v1/cycle`, `/v1/recovery`, `/v1/activity/sleep` and `/v1/activity/workout`
   into the same tables using source `whoop_api`, which already outranks
   `whoop_csv` everywhere it matters
4. Schedule it nightly with `pg_cron`

Apple Health cannot be automated the same way. The nearest option is a
third-party iOS app such as Health Auto Export, which can POST to an endpoint on
a schedule; the alternative is re-running the manual export periodically.

## Design

The interface uses Apple's design language: the grouped-background card stack,
the iOS type scale, continuous corner radii, Liquid Glass translucency on the
tab bar and the two summary cards, and the system colour palette.

A caveat worth stating plainly: there are no public screenshots of Apple's
redesigned Health screens, so this is built to the *reported structure* and to
Apple's published design language — not a copy of an unreleased design.

### Charts

The chart palette is Apple Health's category hues stepped to pass the
colour-blind and contrast gates. Raw iOS system colours do not pass on their
own — most sit outside the usable lightness band and fall under 3:1 on white —
so each hue was snapped to a step inside the band and the set re-validated.
Both modes now clear all five checks with no contrast relief needed.

| Slot | Category | Light | Dark |
|---|---|---|---|
| 1 | Heart | `#cd0441` | `#f70550` |
| 2 | Hearing | `#006bd4` | `#0282fe` |
| 3 | Move | `#9b5f04` | `#bb7304` |
| 4 | Respiratory | `#00889e` | `#0797ab` |
| 5 | Mental wellbeing | `#a104da` | `#bf26ff` |
| 6 | Nutrition | `#04862f` | `#05a23b` |
| 7 | Sleep | `#5945ff` | `#6f70fe` |
| 8 | Metabolic | `#836d00` | `#9e8402` |

Things to keep in mind if you extend the charts:

- Series colours are assigned by slot and never cycled, and each detail tab
  draws in its own category's hue
- **Sleep stages and heart-rate zones are ordinal, so they use single-hue ramps,
  not categorical slots.** This is both the correct encoding and the only one
  available: none of the 70 four-colour subsets of the palette clears the
  all-pairs separation floors in both modes, and a stacked bar puts every
  segment against every other
- The Longevity grid shows seven categories at once, which is past what any
  eight-hue set can separate, so the meter encodes the *score band* and the
  category colour shrinks to a dot beside its own name
- No chart uses two y-axes; two measures of different scale get two charts
- Every chart has a table view — the accessibility path to the numbers
- Dark mode is a separate set of steps chosen for the dark surface, not an
  inversion of the light ones

To change any colour, re-run `scripts/validate_palette.js` from the data-viz
skill. The slot *ordering* is the colour-blind-safety mechanism, not a
cosmetic choice.
