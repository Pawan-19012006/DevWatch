/**
 * DevWatch — core/snapshotManager.js
 *
 * Pillar 4 — Dev Session Snapshot & Restore
 *
 * Captures the current developer session state (active projects, git branches,
 * open ports) as a JSON file and can restore it later by reopening terminal
 * windows at each saved project root.
 *
 * Storage layout
 * ──────────────
 *   ~/.local/share/devwatch/snapshots/
 *     2026-03-03_14-30-00_my-label.json
 *     2026-03-03_09-15-00_auto.json
 *     …
 *
 * Snapshot schema (version 1)
 * ───────────────────────────
 *   {
 *     version    : 1,
 *     label      : string,          // user-supplied or "auto"
 *     savedAt    : ISO-8601 string,
 *     savedAtMs  : number,          // Date.now()
 *     projects   : ProjectSnap[],
 *     ports      : PortSnap[],
 *   }
 *
 *   ProjectSnap {
 *     root         : string,        // absolute project root path
 *     name         : string,        // basename of root
 *     branch       : string | null, // current git branch (null if not a git repo)
 *     processNames : string[],      // unique process names at snapshot time
 *     totalMemKb   : number,
 *   }
 *
 *   PortSnap {
 *     port        : number,
 *     protocol    : string,
 *     processName : string | null,
 *     projectRoot : string | null,
 *     isDevPort   : boolean,
 *   }
 *
 * Usage
 * ─────
 *   const mgr = new SnapshotManager();
 *   const snap = await mgr.save(projectMap, portResult, 'before-refactor');
 *   const list = await mgr.list();      // newest first
 *   const data = await mgr.load(list[0].filename);
 *   await mgr.restore(data);            // opens gnome-terminal at each root
 *   await mgr.delete(list[0].filename);
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { execCommunicate, isCancelledError } from '../utils/subprocess.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const SNAPSHOT_VERSION = 1;

/** Maximum number of saved snapshots to keep on disk (oldest pruned). */
const MAX_SNAPSHOTS = 20;

// ─────────────────────────────────────────────────────────────────────────────

export class SnapshotManager {
    constructor() {
        /** @type {Gio.Cancellable|null} */
        this._cancellable = null;

        /** Absolute path to the snapshots directory. */
        this._snapshotDir = GLib.build_filenamev([
            GLib.get_home_dir(),
            '.local', 'share', 'devwatch', 'snapshots',
        ]);
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** @param {Gio.Cancellable} cancellable */
    start(cancellable) {
        this._cancellable = cancellable;
        this._ensureDir();
    }

    stop() {
        this._cancellable = null;
    }

    /**
     * Save the current session state to a timestamped JSON file.
     *
     * @param {Map<string, import('./processTracker.js').ProjectData>} projectMap
     * @param {import('./portMonitor.js').PortScanResult} portResult
     * @param {string} [label='auto']
     * @returns {Promise<SnapshotMeta>}  Metadata about the saved snapshot.
     */
    async save(projectMap, portResult, label = 'auto') {
        const now     = new Date();
        const isoNow  = now.toISOString();
        const stamp   = _dateToStamp(now);
        const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
        const filename  = `${stamp}_${safeLabel}.json`;

        // Resolve git branches for all project roots concurrently
        const roots = [...(projectMap?.keys() ?? [])];
        const branches = await Promise.all(
            roots.map(root => this._gitBranch(root))
        );
        const branchMap = new Map(roots.map((r, i) => [r, branches[i]]));

        // Build ProjectSnap array
        const projects = roots.map(root => {
            const pd = projectMap.get(root);
            const names = [...new Set((pd?.processes ?? []).map(p => p.name))];
            return {
                root,
                name:         pd?.name ?? GLib.path_get_basename(root),
                branch:       branchMap.get(root) ?? null,
                processNames: names,
                totalMemKb:   pd?.totalMemKb ?? 0,
            };
        });

        // Build PortSnap array
        const ports = (portResult?.ports ?? []).map(r => ({
            port:        r.port,
            protocol:    r.protocol,
            processName: r.processName ?? null,
            projectRoot: r.projectRoot ?? null,
            isDevPort:   r.isDevPort,
        }));

        const snapshot = {
            version:   SNAPSHOT_VERSION,
            label,
            savedAt:   isoNow,
            savedAtMs: now.valueOf(),
            projects,
            ports,
        };

        await this._writeJson(filename, snapshot);
        await this._pruneOldSnapshots();

        console.log(`[DevWatch:SnapshotManager] Saved snapshot: ${filename}`);
        return { filename, label, savedAt: isoNow, projectCount: projects.length };
    }

    /**
     * List all saved snapshots, newest first.
     * @returns {Promise<SnapshotMeta[]>}
     */
    async list() {
        const dir = Gio.File.new_for_path(this._snapshotDir);

        let enumerator;
        try {
            enumerator = await new Promise((resolve, reject) => {
                dir.enumerate_children_async(
                    'standard::name,standard::type',
                    Gio.FileQueryInfoFlags.NONE,
                    GLib.PRIORITY_DEFAULT,
                    this._cancellable,
                    (_src, res) => {
                        try { resolve(dir.enumerate_children_finish(res)); }
                        catch (e) { reject(e); }
                    }
                );
            });
        } catch (e) {
            if (!isCancelledError(e))
                console.warn('[DevWatch:SnapshotManager] list() failed:', e.message);
            return [];
        }

        const metas = [];
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            const name = info.get_name();
            if (!name.endsWith('.json')) continue;
            const meta = _filenameToMeta(name);
            if (meta) metas.push(meta);
        }
        enumerator.close(null);

        // Newest first
        metas.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
        return metas;
    }

    /**
     * Load the full snapshot data from a file.
     * @param {string} filename  Bare filename (not full path).
     * @returns {Promise<object|null>}
     */
    async load(filename) {
        const path = GLib.build_filenamev([this._snapshotDir, filename]);
        const file = Gio.File.new_for_path(path);
        try {
            const [, contents] = file.load_contents(null);
            const text = new TextDecoder().decode(contents);
            return JSON.parse(text);
        } catch (e) {
            console.error('[DevWatch:SnapshotManager] load() failed:', e.message);
            return null;
        }
    }

    /**
     * Restore a snapshot by opening a gnome-terminal (or xterm) at each
     * project root with the saved branch info displayed in the title.
     * @param {object} snapshot  Full snapshot data from load().
     * @returns {Promise<void>}
     */
    async restore(snapshot) {
        const projects = snapshot?.projects ?? [];
        if (projects.length === 0) {
            console.log('[DevWatch:SnapshotManager] restore(): snapshot has no projects');
            return;
        }

        for (const proj of projects) {
            if (!proj.root) continue;

            // Verify the directory still exists
            const dir = Gio.File.new_for_path(proj.root);
            if (!dir.query_exists(null)) {
                console.warn(`[DevWatch:SnapshotManager] restore(): root gone: ${proj.root}`);
                continue;
            }

            const branchNote = proj.branch ? `(${proj.branch})` : '';
            const title = `${proj.name} ${branchNote}`.trim();

            // Try gnome-terminal first, then xterm
            for (const argv of [
                ['gnome-terminal', `--title=${title}`, `--working-directory=${proj.root}`],
                ['xterm', '-title', title, '-e', `cd "${proj.root}" && exec $SHELL`],
            ]) {
                try {
                    const launcher = new Gio.SubprocessLauncher({
                        flags: Gio.SubprocessFlags.NONE,
                    });
                    launcher.spawnv(argv);
                    console.log(`[DevWatch:SnapshotManager] Restored terminal: ${title}`);
                    break;
                } catch (_) { /* try next */ }
            }
        }
    }

    /**
     * Delete a snapshot file.
     * @param {string} filename  Bare filename.
     * @returns {Promise<boolean>}
     */
    async delete(filename) {
        const path = GLib.build_filenamev([this._snapshotDir, filename]);
        const file = Gio.File.new_for_path(path);
        try {
            file.delete(null);
            console.log(`[DevWatch:SnapshotManager] Deleted: ${filename}`);
            return true;
        } catch (e) {
            console.error('[DevWatch:SnapshotManager] delete() failed:', e.message);
            return false;
        }
    }

    // ── Private ─────────────────────────────────────────────────────────────

    /** Create snapshot directory if it doesn't exist. */
    _ensureDir() {
        try {
            const dir = Gio.File.new_for_path(this._snapshotDir);
            dir.make_directory_with_parents(null);
        } catch (e) {
            // G_IO_ERROR_EXISTS is expected on subsequent calls — ignore it
            if (!e.message?.includes('exists') && !e.message?.includes('File exists'))
                console.warn('[DevWatch:SnapshotManager] _ensureDir():', e.message);
        }
    }

    /**
     * Get current git branch for a project root.
     * Returns null if not a git repo or git is unavailable.
     * @param {string} root
     * @returns {Promise<string|null>}
     */
    async _gitBranch(root) {
        try {
            const out = await execCommunicate(
                ['git', '-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'],
                this._cancellable
            );
            return out.trim() || null;
        } catch (_) {
            return null;
        }
    }

    /**
     * Write JSON data to a file in the snapshot directory.
     * @param {string} filename
     * @param {object} data
     */
    async _writeJson(filename, data) {
        const path = GLib.build_filenamev([this._snapshotDir, filename]);
        const file = Gio.File.new_for_path(path);
        const text = JSON.stringify(data, null, 2);
        const bytes = new TextEncoder().encode(text);

        await new Promise((resolve, reject) => {
            file.replace_contents_bytes_async(
                GLib.Bytes.new(bytes),
                null,   // etag
                false,  // make_backup
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                this._cancellable,
                (_src, res) => {
                    try { file.replace_contents_finish(res); resolve(); }
                    catch (e) { reject(e); }
                }
            );
        });
    }

    /**
     * Remove the oldest snapshot files if we exceed MAX_SNAPSHOTS.
     */
    async _pruneOldSnapshots() {
        const metas = await this.list(); // already sorted newest-first
        const toDelete = metas.slice(MAX_SNAPSHOTS);
        for (const m of toDelete) await this.delete(m.filename);
    }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Format a Date as "YYYY-MM-DD_HH-MM-SS" for use in filenames.
 * @param {Date} d
 * @returns {string}
 */
function _dateToStamp(d) {
    const pad = n => String(n).padStart(2, '0');
    return [
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`,
    ].join('_');
}

/**
 * Parse a snapshot filename back into a SnapshotMeta object.
 * Expected format: "YYYY-MM-DD_HH-MM-SS_label.json"
 * @param {string} filename
 * @returns {{ filename: string, label: string, savedAt: string } | null}
 */
function _filenameToMeta(filename) {
    // Match: 2026-03-03_14-30-00_some-label.json
    const m = filename.match(
        /^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}-\d{2})_(.+)\.json$/
    );
    if (!m) return null;

    const [, datePart, timePart, label] = m;
    const timeIso = timePart.replace(/-/g, ':');
    const savedAt = `${datePart}T${timeIso}`;

    return { filename, label, savedAt };
}
