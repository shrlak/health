# Whoop widget for macOS

A Notification Center / desktop widget showing today's recovery, strain and
sleep, plus a fourteen-day recovery trend on the medium size.

It reads one endpoint — `whoop-widget` — with a read-only token. The token can
do nothing but fetch that summary: it cannot write data and cannot reach the
rest of the account.

## Building it

macOS only offers widgets that ship inside an installed app, so this has to be
built once on the machine that will run it. There is no way around that and no
prebuilt binary to download.

```sh
brew install xcodegen      # once
./setup.sh                 # asks for the token, then opens Xcode
```

In Xcode, pick your name under **Signing & Capabilities** for both the `Whoop`
and `WhoopWidget` targets — a free Apple ID is enough — then press Run.

The app window appears and shows the same figures. Once it has run once, the
widget is registered: right-click the desktop → **Edit Widgets**, search for
**Whoop**, and drag the size you want into place.

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
