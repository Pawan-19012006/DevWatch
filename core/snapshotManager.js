/**
 * DevWatch — core/snapshotManager.js
 *
 * Pillar 4 — Dev Session Snapshot & Restore
 *
 * Captures the current developer session state (active projects, git branches,
 * open ports, and the exact commands used to run each service) as a JSON file
 * and can restore it later by relaunching those commands in the correct dirs.
 *
 * Storage layout
 * ──────────────
 *   ~/.local/share/devwatch/snapshots/
 *     2026-03-03_14-30-00_my-label.json
 *     2026-03-03_09-15-00_auto.json
 *     …
 *
 * Snapshot schema (version 2)
 * ───────────────────────────
 *   {
 *     version    : 2,
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
 *     processNames : string[],      // unique process names at snapshot time (legacy)
 *     totalMemKb   : number,
 *     services     : ServiceSnap[], // NEW in v2 — launchable service records
 *   }
 *
 *   ServiceSnap {
 *     cmdline  : string,        // full command as string (e.g. "python manage.py runserver")
 *     argv     : string[],      // tokenised argv for direct exec (no shell quoting issues)
 *     cwd      : string,        // working directory the process was started from
 *     port     : number | null, // port the service is bound to (null if unbound / unknown)
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
 *   await mgr.restore(data);            // relaunches saved services
 *   await mgr.delete(list[0].filename);
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import { execCommunicate, isCancelledError } from '../utils/subprocess.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const SNAPSHOT_VERSION = 2;

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

        // Build a pid→port map from the port scan result so we can annotate
        // each service with the port it was listening on at save time.
        const pidToPort = new Map();
        for (const r of (portResult?.ports ?? [])) {
            if (r.pid && !pidToPort.has(r.pid)) pidToPort.set(r.pid, r.port);
        }

        // Build ProjectSnap array
        const projects = roots.map(root => {
            const pd = projectMap.get(root);
            const names = [...new Set((pd?.processes ?? []).map(p => p.name))];

            // Build ServiceSnap array — one entry per distinct cmdline.
            // Filter out bare shell launchers and kernel threads (no cmdline).
            const seenArgv = new Set();
            const services = [];
            for (const proc of (pd?.processes ?? [])) {
                const argv = _normaliseArgv(proc.cmdline);
                if (!argv) continue;
                const key = argv.join('\0');
                if (seenArgv.has(key)) continue;
                seenArgv.add(key);
                services.push({
                    cmdline: argv.join(' '),
                    argv,
                    cwd:  proc.cwd ?? root,
                    port: pidToPort.get(proc.pid) ?? null,
                });
            }

            return {
                root,
                name:         pd?.name ?? GLib.path_get_basename(root),
                branch:       branchMap.get(root) ?? null,
                processNames: names,
                totalMemKb:   pd?.totalMemKb ?? 0,
                services,
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
        const totalServices = projects.reduce((n, p) => n + (p.services?.length ?? 0), 0);
        return { filename, label, savedAt: isoNow, projectCount: projects.length, serviceCount: totalServices };
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

        // Enrich metas with service/project counts from the file contents
        for (const meta of metas) {
            try {
                const path = GLib.build_filenamev([this._snapshotDir, meta.filename]);
                const [, raw] = Gio.File.new_for_path(path).load_contents(null);
                const data = JSON.parse(new TextDecoder().decode(raw));
                meta.projectCount  = data.projects?.length ?? 0;
                meta.serviceCount  = (data.projects ?? [])
                    .reduce((n, p) => n + (p.services?.length ?? 0), 0);
            } catch (_) {
                meta.projectCount = meta.projectCount ?? 0;
                meta.serviceCount = 0;
            }
        }

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
     * Restore a snapshot by relaunching each saved service command in its own
     * terminal window.  For v1 snapshots (no services array), falls back to
     * opening a terminal at the project root.
     *
     * Port-conflict detection: if a service's port is already listening,
     * that service is skipped to avoid duplicate processes.
     *
     * @param {object} snapshot  Full snapshot data from load().
     * @returns {{ launched: number, skipped: number }}
     */
    async restore(snapshot) {
        const projects = snapshot?.projects ?? [];
        if (projects.length === 0) {
            console.log('[DevWatch:SnapshotManager] restore(): snapshot has no projects');
            return { launched: 0, skipped: 0 };
        }

        // Snapshot of currently listening ports — lets us skip services that
        // are already running so we never create duplicate processes.
        const occupiedPorts = this._readOccupiedPorts();

        let launched = 0;
        let skipped  = 0;

        for (const proj of projects) {
            if (!proj.root) continue;

            // Verify the directory still exists
            const dir = Gio.File.new_for_path(proj.root);
            if (!dir.query_exists(null)) {
                console.warn(`[DevWatch:SnapshotManager] restore(): root gone: ${proj.root}`);
                continue;
            }

            const services = proj.services ?? [];

            if (services.length === 0) {
                // v1 snapshot or project with no captured commands — just open a shell
                this._openTerminal(proj.root, proj.name, proj.branch);
                launched++;
                continue;
            }

            for (const svc of services) {
                // Skip if port already occupied
                if (svc.port && occupiedPorts.has(svc.port)) {
                    console.log(
                        `[DevWatch:SnapshotManager] restore(): port ${svc.port} already in use,` +
                        ` skipping: ${svc.cmdline}`
                    );
                    skipped++;
                    continue;
                }

                const cwd = svc.cwd ?? proj.root;
                this._launchService(svc, cwd, proj.name);
                launched++;
            }
        }

        console.log(
            `[DevWatch:SnapshotManager] restore(): launched=${launched} skipped=${skipped}`
        );
        return { launched, skipped };
    }

    // ── Terminal helpers ─────────────────────────────────────────────────────

    /**
     * Open a new terminal running a saved service command.
     * The window title shows the project name and command for easy identification.
     * A "press Enter to close" prompt is appended so the terminal stays open
     * if the command exits immediately (e.g. misconfigured command).
     *
     * @param {{ cmdline: string, argv: string[] }} svc
     * @param {string} cwd   Working directory for the command
     * @param {string} projectName
     */
    _launchService(svc, cwd, projectName) {
        const title   = `${projectName} — ${svc.cmdline}`;
        // Wrap in bash -c so multi-word commands (npm run dev, python manage.py …)
        // are tokenised by the shell rather than exec'd literally.
        const shellCmd =
            `${svc.cmdline}; ` +
            `printf '\\n[DevWatch] Process exited (code $?). Press Enter to close.'; read`;

        for (const argv of [
            ['gnome-terminal', `--title=${title}`, `--working-directory=${cwd}`,
             '--', 'bash', '-c', shellCmd],
            ['xterm', '-title', title, '-e',
             `bash -c "cd '${cwd.replace(/'/g, "'\\''")}' && ${shellCmd}"`],
        ]) {
            try {
                const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
                launcher.set_cwd(cwd);
                launcher.spawnv(argv);
                console.log(`[DevWatch:SnapshotManager] Launched service: ${svc.cmdline} (${cwd})`);
                return;
            } catch (e) {
                console.warn(
                    `[DevWatch:SnapshotManager] _launchService via ${argv[0]} failed:`, e.message
                );
            }
        }
    }

    /**
     * Open a bare terminal at a project root (used for v1 snapshots).
     * @param {string} root
     * @param {string} name
     * @param {string|null} branch
     */
    _openTerminal(root, name, branch) {
        const title = branch ? `${name} (${branch})` : name;
        for (const argv of [
            ['gnome-terminal', `--title=${title}`, `--working-directory=${root}`],
            ['xterm', '-title', title, '-e',
             `bash -c "cd '${root.replace(/'/g, "'\\''")}' && exec $SHELL"`],
        ]) {
            try {
                const launcher = new Gio.SubprocessLauncher({ flags: Gio.SubprocessFlags.NONE });
                launcher.spawnv(argv);
                console.log(`[DevWatch:SnapshotManager] Opened terminal: ${title}`);
                return;
            } catch (_) { /* try next */ }
        }
    }

    /**
     * Read /proc/net/tcp and /proc/net/tcp6 to find all currently LISTEN ports.
     * This is a synchronous, zero-subprocess check — safe to call before spawning.
     * @returns {Set<number>}
     */
    _readOccupiedPorts() {
        const occupied = new Set();
        for (const procFile of ['/proc/net/tcp', '/proc/net/tcp6']) {
            try {
                const [, raw] = Gio.File.new_for_path(procFile).load_contents(null);
                const text = new TextDecoder().decode(raw);
                for (const line of text.split('\n').slice(1)) {
                    const cols = line.trim().split(/\s+/);
                    if (cols.length < 4) continue;
                    // col[3] is state: 0A = TCP_LISTEN
                    if (cols[3] !== '0A') continue;
                    const portHex = cols[1].split(':')[1];
                    if (portHex) occupied.add(parseInt(portHex, 16));
                }
            } catch (_) { /* file may not exist on all kernels */ }
        }
        return occupied;
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

/**
 * Normalise a process cmdline array into a clean, launchable argv.
 *
 * Returns null for entries that should not be persisted as services:
 *  - kernel threads / empty cmdlines
 *  - bare interactive shells (bash, zsh, sh, fish …)
 *  - gnome-shell itself
 *
 * @param {string[] | null | undefined} cmdline  Raw /proc/<pid>/cmdline tokens
 * @returns {string[] | null}
 */
function _normaliseArgv(cmdline) {
    if (!cmdline || cmdline.length === 0) return null;

    // Strip interpreter paths — keep only the basename for the first token
    const argv = cmdline.map(t => t.trim()).filter(Boolean);
    if (argv.length === 0) return null;

    const bin = argv[0].replace(/.*\//, ''); // basename

    // Skip plain shells with no arguments (interactive terminals)
    const SHELL_BINS  = new Set(['bash', 'sh', 'zsh', 'fish', 'dash', 'tcsh', 'ksh']);
    // Skip system noise that shouldn't be relaunched
    const SYSTEM_BINS = new Set([
        'gnome-shell', 'systemd', 'dbus-daemon', 'Xwayland',
        'gjs', 'gvfsd', 'at-spi-bus-launcher',
    ]);

    if (SYSTEM_BINS.has(bin)) return null;
    if (SHELL_BINS.has(bin) && argv.length === 1) return null;
    // Shell launched with -c "..." or similar — keep it, it runs a real command
    if (SHELL_BINS.has(bin) && argv.length > 1) return argv;

    return argv;
}
