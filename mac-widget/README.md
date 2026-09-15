# Whoop widget for macOS

A Notification Center / desktop widget showing today's recovery, strain and
sleep, plus a fourteen-day recovery trend on the medium size.

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

### 7. Move it to Applications

Xcode builds into DerivedData, which is a scratch directory. A widget served
from there stops working the moment that directory is cleaned, so move the app
somewhere stable:

1. In the left sidebar, open the **Products** group and right-click
   **Whoop.app** → **Show in Finder**.
2. Drag it into **/Applications**.
3. Launch it from there once.

### 8. Add the widget

Right-click anywhere on the desktop wallpaper and choose **Edit Widgets**. (The
same panel opens from clicking the clock in the menu bar and scrolling to the
bottom.) Search for **Whoop** in the list on the left, then drag either size
onto the desktop or into Notification Center.

## If something goes wrong

| What you see | What it means |
| --- | --- |
| `Signing for "WhoopWidget" requires a development team` | Step 5 was only done for the app target. Set the team on the widget target too. |
| Widget says **Add your token in Config.swift** | `setup.sh` ran without a token. Run it again and paste one. |
| Widget says **Token rejected** | The token was revoked or mistyped. Create a new one on Connections and re-run `setup.sh`. |
| Widget says **Nothing synced yet** | The token works but the account has no Whoop data in the last two weeks. |
| Widget is blank or stuck on placeholder text | Open the Whoop app. It fetches the same endpoint the same way and has room to say what failed. |
| **Whoop** is not in the Edit Widgets list | The app has not been run from a stable location. Do step 7. |
| The number looks stale | WidgetKit budgets refreshes. Open the app and press **Refresh**, which reloads every timeline. |
| The stats are a blank slab, or numbers are missing, until you click the desktop | macOS renders desktop widgets without colour while another window is in front. See [When the desktop is not in front](#when-the-desktop-is-not-in-front). |
| A rebuild changes nothing on the desktop | Xcode builds into DerivedData, but the widget is served from `/Applications/Whoop.app`. Redo step 7 so the copy there is the new one, then check `pluginkit -mAvvv -p com.apple.widgetkit-extension \| grep -A3 shrlak` shows a fresh `Timestamp`. |
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

## Layout

```
small                          medium
┌──────────────┐               ┌────────────────────────────────┐
│  ◜◝          │               │   ◜◝     Sun 14 Sep            │
│ ◟  ◞  82%    │               │  ◟  ◞    STRAIN  5.0  SLEEP 9h │
│              │               │   82%    HRV 84 ms  RHR 45 bpm │
│ STRAIN  5.0  │               │ RECOVERY ╱╲__╱‾╲__╱‾           │
│ SLEEP   9h32 │               │                                │
└──────────────┘               └────────────────────────────────┘
```

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
| `Shared/Views.swift` | The ring, sparkline and stat views, shared by the app and the widget. |
| `Widget/WhoopWidget.swift` | The timeline provider and the two widget layouts. |
| `App/WhoopApp.swift` | The container app, which is also the diagnostic window. |
| `Config.example.swift` | Template for `Shared/Config.swift`. |

A generated `.xcodeproj` is a large file that conflicts on every edit, so it is
not committed; `project.yml` is the thing to change.
