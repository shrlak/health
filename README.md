# Health Dashboard

A personal dashboard for Whoop data, with a Mac widget. One web app that works on
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

Whoop syncs automatically once connected, and an app on your iPhone can push
Apple Health on a schedule — see [Automatic syncing](#automatic-syncing). File
import stays available for backfilling history, and is the fastest way to load
years of data at once.

**Apple Health** has no public cloud API. To load history by hand:

1. Open **Health** on your iPhone
2. Tap your photo, top right
3. Scroll down and tap **Export All Health Data**
4. Save the zip and choose it on the Import tab

**Whoop** has a developer API, so the Connections tab is the better route. To
load history by hand instead:

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

`.github/workflows/deploy.yml` builds and publishes on every push to `main`,
and can be run by hand from the Actions tab.

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

## Automatic syncing

The two sources are not symmetrical, and the app says so rather than pretending
otherwise.

**Whoop has a developer API**, so the dashboard genuinely pulls from it. You
authorize once and a scheduled job fetches new cycles, recoveries, sleeps and
workouts every fifteen minutes. Each run asks only for the last two days, so it
is four requests against a limit of a hundred a minute; the cadence costs
almost nothing and means a workout or a new recovery score appears while you
are still looking at it.

Quarter-hourly also sidesteps the question of when a "day" ends. Whoop finalises
a night when you wake, and on an overnight shift that lands anywhere on the
clock — a nightly job would have to guess, and this one does not.

**Apple Health has no cloud API.** HealthKit lives on the device and Apple
provides no server to read it from, so nothing can pull it — not this dashboard
and not anything else. Every "Apple Health integration" works the same way:
something on the phone sends the data out. So the app exposes a push endpoint
instead and an app on your iPhone posts to it on a schedule.

Both land in the same tables as the file importers, so the dashboard does not
care how a row arrived.

### One-time setup

Everything below is on the **Connections** tab in the app, except the two
credential steps, which need the Supabase dashboard.

**1. Register a Whoop app** at [developer.whoop.com](https://developer.whoop.com):

- Redirect URI: `https://datihyxdmpshreyifvzn.supabase.co/functions/v1/whoop-callback`
- Scopes: `offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement`

`offline` is the one that matters — without it the connection expires after an
hour and cannot renew itself.

**2. Add the credentials** as Edge Function secrets (Supabase dashboard →
Edge Functions → Secrets):

| Secret | Value |
|---|---|
| `WHOOP_CLIENT_ID` | from your Whoop app |
| `WHOOP_CLIENT_SECRET` | from your Whoop app |
| `APP_URL` | `https://shrlak.github.io/health/` |

The client secret lives only here. It is never sent to the browser, which is
why the OAuth exchange runs in an Edge Function rather than in the page.

**3. Connect.** Open **Connections** in the app and press *Connect Whoop*.

That is the whole of it. The scheduler needs no credential of its own: the
secret it authenticates with is generated by the database in migration `0004`
and read back by the function using the service-role client Supabase injects,
so there is nothing to copy between the two.

An earlier version did ask for one, with a SQL snippet whose placeholder was
easy to paste unchanged — and that is exactly what happened, leaving the job
firing on schedule against the literal text `<service role key>` while
nothing in the UI said so. Steps a person can silently get wrong are worth
designing out rather than documenting more loudly.

**4. Optionally, the Mac widget.** Create a read-only token on the same page
and follow [`mac-widget/README.md`](mac-widget/README.md).

### How it is put together

| Function | Role |
|---|---|
| `whoop-connect` | Starts the OAuth round trip and stores a one-time state value |
| `whoop-callback` | Whoop's redirect target; exchanges the code and stores the tokens |
| `whoop-sync` | Pulls new data — called by the schedule for everyone, or by *Sync now* for you |
| `whoop-widget` | Read-only summary for the Mac widget |
| `health-ingest` | Receives Apple Health pushes from the phone |
| `ingest-token` | Mints and revokes long-lived bearer tokens, read-only or writing |

Notes worth keeping in mind if you change any of it:

- Every function validates the caller itself rather than using Supabase's
  built-in `verify_jwt`. That check also accepts the project's anon key, which
  every visitor has — so relying on it would have left token minting open to
  anyone who loaded the page.
- Ingest tokens are stored only as SHA-256 hashes. A leaked database row does
  not yield a working credential, and the plaintext is shown exactly once.
- The Whoop sync is incremental, asking for everything since the last success
  less two days of overlap, because Whoop revises a night's scores for a while
  afterwards. Upserts make the overlap harmless.
- Whoop invalidates the previous access token the moment a refresh succeeds, so
  the new pair is persisted before any data request uses it.
- One account's failure is recorded against that account and does not stop the
  rest of a scheduled run.

## The Mac widget

A native WidgetKit widget for the Notification Center and the desktop, in all
three sizes macOS offers. The size is picked when the widget is dragged out,
and each one shows as much as it has room for: small is the glance, large is
the whole summary.

```
small                          medium
┌──────────────┐               ┌────────────────────────────────┐
│  ◜◝          │               │   ◜◝     Sun 14 Sep            │
│ ◟  ◞  82%    │               │  ◟  ◞    STRAIN  5.0  SLEEP 9h │
│              │               │   82%    HRV 84 ms  RHR 45 bpm │
│ STRAIN  5.0  │               │ RECOVERY ╱╲__╱‾╲__╱‾           │
│ SLEEP   9h32 │               │                                │
└──────────────┘               └────────────────────────────────┘

large
┌────────────────────────────────┐
│ WHOOP               Tue 15 Sep │
│    ◜◝       ◜◝       ◜◝        │
│   ◟92%◞    ◟5h20◞   ◟6.7◞      │
│  RECOVERY   SLEEP    STRAIN    │
│   GO 8.1   of 7h57  2009 kcal  │
│ HEART RATE  42 rest·65·122 peak│
│ ▰▰▰▰▰●▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  │
│ ┌────────────────────────────┐ │
│ │ HRV 112 ms ↑44 │ RHR 42 ↓5 │ │
│ │ 7d avg 71 ms   │ 7d avg 47 │ │
│ └────────────────────────────┘ │
│ LAST 7 DAYS ────────────────── │
│ RECOVERY 92% ╱╲_╱ avg 82%      │
│ STRAIN  6.7  ▁▃▅▂▇▄▃ avg 7.3   │
│ HRV     112  ╱╲_╱ avg 71 ms    │
│ Updated 23:19 · 30 days logged │
└────────────────────────────────┘
```

The large size shows the day rather than listing it. The three figures with a
ceiling become three rings of the same shape, so they can be compared at a
glance: recovery out of a hundred, the night against the need Whoop set for it,
the day's strain against a maxed-out one — each captioned with the figure that
belongs with it, the readiness score, the need, the calories. Below them the
day's heart rate is a range rather than three numbers, with the average marked
where it actually fell between the resting rate and the peak. Then HRV and
resting heart rate, the two with no ceiling to draw them against, each shown
against its own week. Then the trends, strain as columns because a day's strain
is a separate effort rather than a level that drifts, the rest as lines, every
one captioned with its average and range so the shape has a scale.

A widget cannot scroll and clips whatever does not fit, so the large layout
offers itself at several densities and the richest one that fits the canvas is
the one drawn.

The source is in [`mac-widget/`](mac-widget/). macOS only offers widgets that
ship inside an installed app, so it is built once on the machine that runs it:
`brew install xcodegen`, then `./setup.sh`, then press Run in Xcode.

It reads one endpoint with a token scoped to reading only. A widget is woken by
the system long after any login session would have expired, so it cannot hold
one; `ingest_tokens.scope` separates a token that can only read this summary
from one that can write health data, and the widget gets the former. Revoking it
on the Connections tab stops the widget at its next refresh.

### A caveat on the Whoop mapping

The Whoop code was written against the published v2 documentation and could not
be exercised against a live account, so every field is read through a tolerant
accessor: a renamed or missing value degrades to null rather than throwing
mid-sync. `npm test` covers the mapping with fixtures built from the documented
shapes — day attribution across timezones, millisecond-to-minute conversions,
kilojoules to kilocalories, metres to kilometres, and that `zone_zero` is
excluded from the five heart-rate zones.

If a sync ever lands wrong data, correct the fixture in `scripts/test-sync.ts`
first and let it fail, then fix the mapper.

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
