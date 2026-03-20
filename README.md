<p align="center">
  <h1 align="center">DevWatch</h1>
  <p align="center"><strong>Your projects. Your ports. Your builds. All in one glance.</strong></p>
  <p align="center">A GNOME Shell extension that turns your Linux desktop into a developer-aware dashboard.</p>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="MIT License"></a>
  <a href="https://extensions.gnome.org"><img src="https://img.shields.io/badge/GNOME%20Shell-45%2B-blue.svg" alt="GNOME 45+"></a>
  <a href="https://www.linux.org"><img src="https://img.shields.io/badge/Platform-Linux-orange.svg" alt="Linux"></a>
  <a href="https://github.com/Adithya-Balan/DevWatch/issues"><img src="https://img.shields.io/badge/Status-Active%20Development-yellow.svg" alt="Active Development"></a>
</p>

---

## What is DevWatch?

DevWatch is a **GNOME Shell panel extension** for Linux developers.

It adds a small **● DevWatch** button to your top panel. Click it, and you'll see — in one dropdown — everything happening across your development environment:

- Which **projects** are running and how much CPU/RAM they use
- Which **ports** are bound and which processes own them
- **Zombie and orphan** processes wasting resources
- A way to **save and restore** your entire dev session
- A history of your **recent builds** with timing and resource stats

**No terminal commands. No switching windows. Just look at the panel.**

---

## Why Use DevWatch?

Every developer runs into these problems:

| The Problem | How DevWatch Solves It |
|---|---|
| *"Which process is using port 3000?"* | See it instantly: `Port 3000 → backend-api (node)` |
| *"I have 20 node processes, which project are they from?"* | Processes grouped by project, not by PID |
| *"I forgot to kill my dev server yesterday"* | Orphan and idle process detection with one-click kill |
| *"I just rebooted, now I need to reopen 5 terminals"* | Save and restore your dev sessions in one click |
| *"My build is slow but I don't know why"* | See build duration, peak CPU, peak RAM for every build |

Tools like `htop` and `lsof` show you **processes**. DevWatch shows you **projects**.

---

## Features

### 🔍 Active Projects

DevWatch detects your running projects using the focused window, terminal working directory, and `git` root.

Each project shows:
- All associated processes grouped together
- Aggregate CPU and memory usage
- **Copy PID** button for any process
- **Open Terminal** button to jump to the project root

### 🌐 Active Ports

Live monitoring of every listening port on your machine.

- Dev ports (3000, 5173, 8080, etc.) are highlighted automatically
- See which process and project owns each port
- **Kill** a port's process with one click
- **Desktop notifications** when a dev port is newly occupied (port conflict alerts)

### 🧹 Cleanup Engine

Finds processes you probably forgot about:

| Type | What It Means |
|---|---|
| ☠ **Zombie** | Process that exited but wasn't cleaned up by its parent |
| ⚱ **Orphan** | A dev tool (node, cargo, etc.) whose parent is gone |
| ⏸ **Idle** | A dev tool using <0.5% CPU for over 10 minutes with no open port |

**Clean All** button to kill all candidates at once, or kill them individually.

### 📷 Session Snapshots

Save your entire dev session (projects, ports, git branches) and restore it later.

- **Save Now** — captures your current environment to a JSON file
- **Restore** — reopens terminals at each project root with the correct branch name
- Up to 20 snapshots stored locally, newest shown first
- **Delete** any snapshot you no longer need

*Perfect for: switching between projects, rebooting, or picking up work the next day.*

### ⚡ Build Performance

Tracks active builds and shows resource usage in real time.

- Detects **35+ build tools**: `npm`, `cargo`, `make`, `go build`, `gradle`, `webpack`, `vite`, and more
- Shows **live CPU%** during builds
- Records **duration**, **peak CPU**, and **peak RAM** for each completed build
- Build history persists across reboots

### ⚙️ Preferences

Fully configurable through GNOME Settings → Extensions → DevWatch → ⚙:

| Setting | What It Controls |
|---|---|
| **Poll interval** | How often DevWatch refreshes (5–60 seconds) |
| **Show system ports** | Toggle visibility of non-dev ports |
| **Port notifications** | Enable/disable conflict alerts |
| **Idle threshold** | Minutes before a dev tool is flagged as idle (1–60 min) |
| **Max history rows** | Number of completed builds shown (1–20) |

### 🔴🟡🟢 Status Dot

The colored dot next to "DevWatch" in the panel tells you the system health at a glance:

| Color | Meaning |
|---|---|
| 🟢 **Green** | Everything is healthy |
| 🟡 **Yellow** | High CPU, idle dev tools, or a build pushing above 90% CPU |
| 🔴 **Red** | Zombie process, orphan process, or new port conflict detected |

---

## Installation

### What You Need

- **GNOME Shell 45 or newer** (Ubuntu 23.10+, Fedora 39+, Arch with GNOME)
- `git`, `make`, `ss` (usually pre-installed on most Linux systems)

### Step 1 — Install Dependencies

**Ubuntu / Debian:**
```bash
sudo apt update
sudo apt install -y git make gettext gnome-shell-extension-prefs
```

**Fedora:**
```bash
sudo dnf install -y git make gettext gnome-extensions-app
```

**Arch Linux:**
```bash
sudo pacman -S --needed git make gettext gnome-extensions
```

### Step 2 — Clone and Install

```bash
git clone https://github.com/Adithya-Balan/DevWatch.git
cd DevWatch
make link
```

> `make link` compiles the settings schema and symlinks the extension files into GNOME's extension directory.

### Step 3 — Enable

```bash
gnome-extensions enable devwatch@github.io
```

### Step 4 — Verify

```bash
gnome-extensions info devwatch@github.io
```

You should see `State: ENABLED`. The **● DevWatch** button will appear in your top panel.

> **Wayland users:** If the extension doesn't appear, log out and log back in.

---

## Usage

### Everyday Use

1. Click **● DevWatch** in the top panel to open the dropdown
2. Browse your **Active Projects**, **Ports**, **Cleanup Candidates**, **Snapshots**, and **Build Performance**
3. Use the action buttons (Kill, Copy PID, Open Terminal, Save, Restore) directly from the dropdown

### Save and Restore a Session

```
Before you leave:  Click "Save Now" in the Snapshots section
Next morning:      Click "Restore" on the saved snapshot
                   → All your project terminals reopen automatically
```

### Kill a Runaway Process

```
Open the dropdown → find the port or process → click "Kill"
```

### Customize Settings

Open GNOME Settings → Extensions → DevWatch → ⚙  
Or run:
```bash
gnome-extensions prefs devwatch@github.io
```

---

## Quick Reference

### Makefile Commands

| Command | What It Does |
|---|---|
| `make link` | Install/update the extension (run after any code change) |
| `make enable` | Enable the extension |
| `make disable` | Disable the extension |
| `make pack` | Build a distributable `.zip` file |
| `make log` | Watch GNOME Shell logs in real time |
| `make nested` | Launch a safe nested GNOME session for testing |
| `make status` | Check if the extension is loaded |

### Where Data Is Stored

All data stays **local on your machine** — nothing is ever sent anywhere.

```
~/.local/share/devwatch/
├── snapshots/          ← Saved session snapshots (JSON files)
└── build_history.json  ← Build performance history
```

To reset all DevWatch data:
```bash
rm -rf ~/.local/share/devwatch/
```

---

## Project Structure

```
DevWatch/
├── extension.js        ← Main entry point
├── prefs.js            ← Preferences window (GTK4/Adwaita)
├── metadata.json       ← Extension identity
├── stylesheet.css      ← UI styles
├── Makefile            ← Build & dev helpers
│
├── core/               ← Logic layer (data processing, no UI)
│   ├── projectDetector.js    — Detects active projects via window focus + git
│   ├── processTracker.js     — Scans /proc and groups processes by project
│   ├── portMonitor.js        — Parses listening ports from ss command
│   ├── conflictNotifier.js   — Fires GNOME notifications on port conflicts
│   ├── snapshotManager.js    — Saves/loads/restores session snapshots
│   └── buildDetector.js      — Tracks build tools, CPU/RAM usage, history
│
├── ui/                 ← UI renderers (display data as panel rows)
│   ├── projectSection.js     — Active Projects section
│   ├── portSection.js        — Active Ports section
│   ├── alertsSection.js      — Cleanup candidates section
│   ├── healthSummary.js      — System health summary
│   ├── snapshotSection.js    — Session Snapshots section
│   └── perfSection.js        — Build Performance section
│
├── utils/              ← Shared helpers
│   ├── subprocess.js         — Async command runner
│   ├── procReader.js         — /proc filesystem reader
│   └── i18n.js               — Translation helpers
│
├── schemas/            ← GSettings schema (user preferences)
└── po/                 ← Translation files (i18n)
```

---

## Contributing

We welcome contributions! Whether it's bug fixes, new features, translations, or documentation improvements.

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for the full guide, including:
- Development setup
- Code style conventions
- Pull request guidelines
- How to add a translation

### Quick Start for Contributors

```bash
# Fork the repo, then:
git clone https://github.com/<your-username>/DevWatch.git
cd DevWatch
make link
gnome-extensions enable devwatch@github.io
make log   # Watch for errors while you develop
```

### Reporting Bugs

Open a [GitHub Issue](https://github.com/Adithya-Balan/DevWatch/issues) with:
- Your GNOME Shell version (`gnome-shell --version`)
- Your Linux distribution
- Steps to reproduce the bug
- Log output from `make log`

---

## Design Principles

- **Project-centric** — organizes everything by project, not by PID
- **Privacy-first** — no cloud, no telemetry, no analytics, 100% local
- **Minimal and clear** — text-first UI, no unnecessary graphs
- **Non-blocking** — async polling, never freezes your desktop
- **Zero dependencies** — runs on GJS + standard Linux tools

---

## License

[MIT](LICENSE) © 2026 [Adithya Balan](https://github.com/Adithya-Balan)

---

<p align="center">
  <strong>Built with ❤️ for Linux developers who want their desktop to understand their workflow.</strong>
</p>
