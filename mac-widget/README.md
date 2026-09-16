# Whoop widget for macOS

A desktop / Notification Center widget showing the day as rings — recovery,
readiness, sleep, strain and the day's burn — with the heart rate from resting
to peak and a labelled week of every metric. It is the same design as the app
window, in a fifth of the room.

It offers the large size only. A widget's size is picked in the gallery when it
is dragged out, and the default is the smallest on offer, so a widget that
registers three families is one you will usually come away with the small
version of. This is written for the large canvas, and offering that alone is
the only way a widget can say so.

It reads one endpoint — `whoop-widget` — with a read-only token. The token can
do nothing but fetch that summary: it cannot write data and cannot reach the
rest of the account.

## Building it

macOS only offers widgets that ship inside an installed app, so this has to be
built once on the machine that will run it. There is no way around that and no
prebuilt binary to download. It is a twenty-minute job, most of which is Xcode
downloading.

### 1. Xcode

Xcode has no supported command-line install — it comes from the App Store, and
it is about 7 GB, so start it before anything else:

```sh
open "macappstore://apps.apple.com/app/id497799835"
```

When it has finished downloading, open it once so it can install its extra
components, then point the command-line tools at it and accept the licence.
Both of these are easy to miss and both break the build if skipped:

```sh
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
xcodebuild -version          # should print Xcode 15 or later
```

### 2. Homebrew and XcodeGen

XcodeGen turns `project.yml` into an `.xcodeproj`. A generated `.xcodeproj` is
a large file that conflicts on every edit, which is why it is built on your
machine rather than committed.

```sh
if ! command -v brew >/dev/null 2>&1; then
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Homebrew is not on PATH straight after installing. Apple Silicon puts it in
  # /opt/homebrew, Intel in /usr/local.
  BREW=/opt/homebrew/bin/brew
  [ -x "$BREW" ] || BREW=/usr/local/bin/brew
  echo "eval \"\$($BREW shellenv)\"" >> ~/.zprofile
  eval "$($BREW shellenv)"
fi

brew install xcodegen
```

### 3. The repository

If you have never cloned it on this Mac:

```sh
mkdir -p ~/Developer
cd ~/Developer
git clone https://github.com/shrlak/health.git
cd health/mac-widget
```

If you have:

```sh
cd ~/Developer/health
git pull
cd mac-widget
```

### 4. The token, then generate

In the dashboard, go to **Connections → Mac widget → Create a token** and copy
what it shows you. It is shown once and stored only as a hash, so if you lose
it you make another.

```sh
./setup.sh
```

It asks for the token. Paste it and press Enter — nothing appears as you type,
which is deliberate: a terminal keeps scrollback. It writes
`Shared/Config.swift`, runs `xcodegen`, and opens `Whoop.xcodeproj`.

### 5. Signing

Xcode will not build until each target has a team. A free Apple ID is enough;
no paid developer account is needed.

1. If you have never signed in: **Xcode → Settings → Accounts → +** → Apple ID,
   and sign in.
2. Click the blue **Whoop** project at the top of the left sidebar.
3. In the target list, select **Whoop** → **Signing & Capabilities** tab.
4. Tick **Automatically manage signing**, then pick yourself under **Team**.
5. Select the **WhoopWidget** target and do the same. Both need it; the widget
   is a separate target and it is the one people forget.

If Xcode complains the bundle identifier is already taken, open `project.yml`,
change `io.github.shrlak.whoop` to something else in both places, and run
`xcodegen generate` again.

### 6. Run it

The scheme control at the top should read **Whoop › My Mac**. Press **⌘R**.

The Whoop window opens and shows your recovery, strain and sleep. If it shows
an error instead, that is the diagnostic — see the troubleshooting list below.

### 7. Install it

Xcode builds into DerivedData, a scratch directory whose name carries a hash
and which gets cleaned. macOS serves a widget from the installed copy of the
app, so a build left in there is a widget showing yesterday's code until the
day that directory is emptied and it stops showing anything.

```sh
./install.sh
```

It asks Xcode where the build went, copies it to `/Applications/Whoop.app`,
and launches it once — which is what registers the widget extension. Run it
after every **⌘R** you want the desktop to pick up.

Two things it gets right that a hand-rolled `find` does not. Xcode's indexer
writes its own `Whoop.app` under `Index.noindex` as a by-product of parsing the
code — it is not built to run, and it is routinely *newer* than the real build,
so picking the first or the most recent match finds the wrong one. And the Run
action's configuration is a per-scheme setting, so a script that assumes Debug
finds nothing on a project set to Release.

If you would rather do it by hand: in Xcode's left sidebar, open the
**Products** group, right-click **Whoop.app** → **Show in Finder**, drag it
into **/Applications**, and launch it from there once. The Products group is
near the bottom of the Project navigator and is easy to miss; `install.sh`
exists because finding that build by hand is the step people get stuck on.

### 8. Add the widget

Right-click anywhere on the desktop wallpaper and choose **Edit Widgets**. (The
same panel opens from clicking the clock in the menu bar and scrolling to the
bottom.) Search for **Whoop** in the list on the left, then drag the size you
want onto the desktop or into Notification Center.

Only the large size is offered, so there is nothing to choose — drag the one
preview out.

If the panel shows you three sizes, the copy in `/Applications` is an older
build than this one. Run `./install.sh` again and check the timestamp it
prints.

## If something goes wrong

| What you see | What it means |
| --- | --- |
| `Signing for "WhoopWidget" requires a development team` | Step 5 was only done for the app target. Set the team on the widget target too. |
| Widget says **Add your token in Config.swift** | `setup.sh` ran without a token. Run it again and paste one. |
| Widget says **Token rejected** | The token was revoked or mistyped. Create a new one on Connections and re-run `setup.sh`. |
| Widget says **Nothing synced yet** | The token works but the account has no Whoop data in the last two weeks. |
| It shows fewer trend rows than the screenshot | Expected. It fits itself to the canvas your Mac gives it; see [Why it sometimes shows fewer trend rows](#why-it-sometimes-shows-fewer-trend-rows). |
| A figure shows a dash, or the calories ring is empty | The app is newer than the deployed `whoop-widget` function, so a field it wants is not in the payload yet. Redeploy it (`supabase functions deploy whoop-widget --no-verify-jwt`) and the next refresh fills it in. Every added field decodes as optional, so an old backend costs you that figure and nothing else. |
| Widget is blank or stuck on placeholder text | Open the Whoop app. It fetches the same endpoint the same way and has room to say what failed. |
| **Whoop** is not in the Edit Widgets list | The app has not been run from `/Applications`. Run `./install.sh`. |
| You cannot find `Whoop.app` to copy | It is in DerivedData under a hashed directory name. Run `./install.sh`, which asks Xcode where the build went rather than making you look for it — and skips the indexer's copy under `Index.noindex`, which is not a runnable build. |
| The number looks stale | WidgetKit budgets refreshes. Open the app and press **Refresh**, which reloads every timeline. |
| Numbers missing, or cut off at an edge | A build from before the layouts owned their margins. `git pull`, then rebuild with **⌘R** — the widget reloads once the new app has launched. |
| The stats are a blank slab, or numbers are missing, until you click the desktop | macOS renders desktop widgets without colour while another window is in front. See [When the desktop is not in front](#when-the-desktop-is-not-in-front). |
| A rebuild changes nothing on the desktop | Xcode builds into DerivedData, but the widget is served from `/Applications/Whoop.app`. Run `./install.sh` so the copy there is the new one, then check `pluginkit -mAvvv -p com.apple.widgetkit-extension \| grep -A3 shrlak` shows a fresh `Timestamp`. |
| A wall of `com.apple.linkd.autoShortcut` errors in the console | Not a failure, and it only appears once the app has launched. Every sandboxed app tries to register with the Shortcuts service at startup and the sandbox denies it; this one uses no App Intents, so nothing is lost. Filter the Xcode console by `Whoop` to hide it. |

## Where the token lives

`setup.sh` writes it into `Shared/Config.swift`, which is git-ignored. It is a
working credential for your data, so it does not belong in a public repository.
Revoking it on the dashboard (Connections → Mac widget) stops the widget
immediately; run `./setup.sh` again with a new one to restore it.

## How fresh the numbers are

The widget asks for new data about every fifteen minutes, though WidgetKit
budgets refreshes and treats that as a request rather than a promise. Behind it,
the backend re-pulls from Whoop on the same quarter-hourly cadence, so the
number the widget shows is rarely more than half an hour behind Whoop itself.

Whoop scores a night when you wake, so the newest complete day is often
yesterday's date — the widget labels which day it is showing rather than
assuming today.

## What it shows

```
┌────────────────────────────────┐
│ Sep 15 (Tue)         Go for it │
│  ◜◝    ◜◝    ◜◝    ◜◝    ◜◝    │
│ ◟92%◞ ◟8.1◞ ◟72%◞ ◟6.7◞ ◟2052◞ │
│ RECOV  READY SLEEP STRAIN  CAL │
│  ↑37   of 10 5h20m of 21   ↓93 │
│ LAST 7 DAYS ────────────────── │
│ RECOVERY 92%↑37 ╱╲_╱   avg 82% │
│ STRAIN  6.7↓3.4 ▁▃▅▂▇▄ avg 7.3 │
│ SLEEP 5h20m↓1h52 ╱╲_╱ avg 8h21m│
│ HEART ───────────────────────  │
│ HEART RATE   42 rest·65·122 pk │
│ ▰▰▰▰▰●▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  │
│ HRV    112ms↑44 ╱╲_╱ avg 86 ms │
│ RESTING  42↓5   ╱╲_╱ avg 45bpm │
│ AVG HR   65↓1   ╱╲_╱ avg 62bpm │
│ PEAK HR 122↓23  ╱╲_╱ avg132bpm │
│ Updated 23:55 · 30 days logged │
└────────────────────────────────┘
```

### What it draws, and why

Three things on it are drawn rather than written:

- **The rings.** Recovery, readiness, sleep, strain and the day's burn are the
  five figures with a ceiling — a hundred percent, ten, the need Whoop set for
  the night, a maxed-out day at 21, and yesterday's calories — so they get the
  same shape and can be compared without reading the numbers. Each shows its
  figure in the middle and what it is measured against underneath. The sleep
  ring draws Whoop's own sleep performance when it has scored one, so the arc
  and the number inside it are the same figure.
- **The heart-rate range.** Resting, average and peak as one track rather than
  three numbers, with the average marked where it actually fell between the
  other two. Three figures in a column say what they were; the track says how
  hard the day was.
- **Strain as columns.** Every other trend is a line, which reads as one
  continuous thing and suits a metric that drifts between readings. A day's
  strain is a separate effort each time, and bars say that where a line implies
  a slope between them.

### Why it sometimes shows fewer trend rows

A widget cannot scroll, and it clips whatever does not fit instead of shrinking
it. macOS also does not hand every Mac the same canvas for a large widget. So
the large layout is written once and offered at several densities — five trend
rows down to none, with the rings and the gaps tightening as it goes, and the
heart-rate track giving way last — and `ViewThatFits` draws the richest one
that actually fits. The rings and the day's numbers are in every variant.

## When the desktop is not in front

macOS draws a desktop widget in colour only while the desktop itself is the
front-most thing. Click any window and every desktop widget switches to
WidgetKit's `.vibrant` rendering: hue is discarded and what is left is
flattened into a wallpaper-tinted material, each pixel's opacity taken from
its luminance. Click the wallpaper and the colour comes back.

Nothing in the glass survives that on its own, and one piece of it actively
breaks. `Material` has no vibrant representation, so the stat tile's
`.ultraThinMaterial` was drawn as a solid at full brightness — an opaque slab
covering the numbers inside it. Blurs, shadows and glows flatten the same way,
into haze rather than depth, and the per-metric accents are mid-tones, which is
exactly what the mask has least room for.

So every view asks `\.widgetRenderingMode` which mode it is in. In colour it
draws the glass as designed; in the monochrome modes it draws flat — no
material, no blur, no glow, white ink, hierarchy by opacity. The fade itself is
the system's and a widget cannot opt out of it, but it can stay readable inside
it.

If you would rather it never faded, that is a system setting rather than
anything here: **System Settings → Desktop & Dock → Widgets**, where *Widget
style* set to **Full-color** keeps the colour whether or not the desktop is in
front. **Automatic** is the setting that fades it.

## If it is blank

Open the `Whoop` app itself. It fetches the same endpoint the same way, and
unlike the widget it has room to say what went wrong — a rejected token, an
account with nothing synced yet, or no network.

## Files

| Path | What it is |
| --- | --- |
| `project.yml` | The Xcode project, as a spec. Generated into `Whoop.xcodeproj` by `xcodegen`. |
| `Shared/Summary.swift` | The response model, the fetch, and the display formatting. |
| `Shared/Views.swift` | The rings, heart-rate track, sparklines and bars, shared by the app and the widget. |
| `Widget/WhoopWidget.swift` | The timeline provider and the widget layouts. Only the large one is offered; the small and medium layouts are kept for re-offering their family. |
| `App/WhoopApp.swift` | The container app, which is also the diagnostic window. It draws the same figures at a larger type scale. |
| `setup.sh` | Writes the token into `Shared/Config.swift` and generates the Xcode project. |
| `install.sh` | Copies the built app from DerivedData to `/Applications`, where macOS serves the widget from. |
| `Config.example.swift` | Template for `Shared/Config.swift`. |

A generated `.xcodeproj` is a large file that conflicts on every edit, so it is
not committed; `project.yml` is the thing to change.
