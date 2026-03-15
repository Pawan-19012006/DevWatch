/**
 * DevWatch — Project-Aware Developer Intelligence Layer
 * Main extension entry point (GNOME 45+, ESM)
 *
 * Pillar 1 — fully wired:
 *   • PanelMenu.Button with status dot (green/yellow/red)
 *   • ProjectDetector  — tracks focused window → project root
 *   • ProcessTracker   — scans /proc, groups processes by project
 *   • buildProjectSection — renders live data into the dropdown
 *   • GLib.timeout polling (every 10s) + on-open refresh
 *   • All resources strictly cleaned up in disable()
 *
 * Pillar 2 — fully wired:
 *   • PortMonitor     — ss -tulnp, dev-port set, runtime tracking
 *   • ConflictNotifier — Main.notify on newly occupied dev ports
 *   • buildPortSection — Kill / Copy PID per port row
 *
 * Pillar 3 — fully wired:
 *   • Status dot: red on zombie OR port conflict, yellow on orphan/idle/highCPU
 *
 * Pillar 4 — fully wired:
 *   • SnapshotManager  — save/list/load/restore/delete session JSON
 *   • buildSnapshotSection — Save Now, Restore, Delete per snapshot row
 *
 * Pillar 5 — fully wired:
 *   • BuildDetector    — active build tracking + persisted run history
 *   • buildPerfSection — active builds + recent-build history rows
 *   • Status dot: red if active build pushing CPU >90%
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { ProjectDetector }    from './core/projectDetector.js';
import { ProcessTracker }     from './core/processTracker.js';
import { PortMonitor }        from './core/portMonitor.js';
import { ConflictNotifier }   from './core/conflictNotifier.js';
import { SnapshotManager }      from './core/snapshotManager.js';
import { buildProjectSection }  from './ui/projectSection.js';
import { buildPortSection }     from './ui/portSection.js';
import { buildSnapshotSection } from './ui/snapshotSection.js';
import { BuildDetector }         from './core/buildDetector.js';
import { buildPerfSection }      from './ui/perfSection.js';
import { buildHealthSummary, clearHealthSummary } from './ui/healthSummary.js';
import { buildAlertsSection } from './ui/alertsSection.js';

/** Fallback poll interval — used before settings load (should never be needed). */
const DEFAULT_POLL_INTERVAL_S = 10;

export default class DevWatchExtension extends Extension {
    constructor(metadata) {
        super(metadata);
    }

    enable() {        // Initialise translations before any string is rendered
        this.initTranslations();
        // ── Cancellable — shared across all async operations ───────────
        this._cancellable = new Gio.Cancellable();

        // ── Core modules ───────────────────────────────────────────────
        this._projectDetector   = new ProjectDetector();
        this._processTracker    = new ProcessTracker();
        this._portMonitor       = new PortMonitor();
        this._conflictNotifier  = new ConflictNotifier();
        this._snapshotManager   = new SnapshotManager();
        this._buildDetector     = new BuildDetector();

        // ── GSettings ─────────────────────────────────────────────────
        this._settings = this.getSettings();
        // Restart the poll timer live when the user changes the interval
        this._settingsChangedId = this._settings.connect(
            'changed::poll-interval',
            () => this._restartPollTimer()
        );

        /**
     * Build the static skeleton of the dropdown (header, separators, footer).
     * The dynamic projects section is injected by buildProjectSection().
     */
    _buildMenuSkeleton() {
        // Health summary (title + stats + refresh icon) is built dynamically
        // by buildHealthSummary() on every _refresh() — nothing static here.
    }

    /**
     * Update the panel status dot colour based on overall dev health.
     *
     * Red    — newly conflicting port
     * Yellow — high CPU (>80%)
     * Green  — all clear
     *
     * @param {Map<string, object>} projectMap
     * @param {{ ports: object[], newPorts: object[] }} portResult
     */
    _updateStatusDot(
        projectMap,
        portResult     = { ports: [], newPorts: [] },
        buildResult    = { active: [], history: new Map() }
    ) {
        if (!this._statusDot) return;

        const hasConflict  = portResult.newPorts?.length > 0;
        const highCpu      = projectMap && [...projectMap.values()].some(p =>
            p.totalCpuPercent > 80
        );
        // A build hammering the CPU signals active work (yellow — not an error)
        const buildingHot  = buildResult.active?.some(r => r.peakCpuPct > 90);

        let dotClass = 'devwatch-dot-green';
        if (hasConflict) dotClass = 'devwatch-dot-red';
        else if (highCpu || buildingHot) dotClass = 'devwatch-dot-yellow';

        this._statusDot.style_class = `devwatch-dot ${dotClass}`;
    }
