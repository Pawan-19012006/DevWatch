/**
 * DevWatch — ui/alertsSection.js
 *
 * Section: "Problems" — appears only when issues are detected.
 * Shown above "Running Projects" so developers see problems first.
 *
 *   Problems
 *   ⚠  tracktite  using 3.2 GB RAM
 *   ⚠  1 zombie process detected
 *   ⚠  node server idle for 2h 14m
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-alerts';

/**
 * @param {PopupMenu.PopupMenu}      menu
 * @param {Map<string, object>}      projectMap
 * @param {{ ports: object[] }}      portResult
 * @param {{ candidates: object[] }} cleanupResult
 */
export function buildAlertsSection(menu, projectMap, portResult, cleanupResult) {
    clearAlertsSection(menu);

    const alerts = _collectAlerts(projectMap, portResult, cleanupResult);
    if (alerts.length === 0) return; // Hidden entirely when healthy

    // Section header
    const titleItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    titleItem._devwatchSection = SECTION_TAG;
    const titleRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    titleRow.add_child(new St.Label({ text: _('Problems'), style_class: 'dw-alert-section-label' }));
    titleItem.add_child(titleRow);
    titleItem.label.hide();
    menu.addMenuItem(titleItem);

    for (const { text, severity } of alerts) {
        const row = new PopupMenu.PopupMenuItem('', { reactive: false });
        row._devwatchSection = SECTION_TAG;
        const label = new St.Label({
            text,
            style_class: severity === 'high' ? 'dw-alert-row-high' : 'dw-alert-row-warn',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        row.add_child(label);
        row.label.hide();
        menu.addMenuItem(row);
    }

    _addSep(menu);
}

export function clearAlertsSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

// ── Alert collection ───────────────────────────────────────────────────────────

function _collectAlerts(projectMap, portResult, cleanupResult) {
    const alerts = [];

    // High RAM / CPU per project
    if (projectMap) {
        for (const p of projectMap.values()) {
            const ramGb = (p.totalMemKb ?? 0) / 1024 / 1024;
            if (ramGb > 2) {
                alerts.push({ text: `⚠  ${p.name}  using ${ramGb.toFixed(1)} GB RAM`, severity: 'warn' });
            } else if (p.totalCpuPercent > 80) {
                alerts.push({ text: `⚠  ${p.name}  CPU at ${p.totalCpuPercent.toFixed(0)}%`, severity: 'warn' });
            }
        }
    }

    // Cleanup candidates
    const candidates = cleanupResult?.candidates ?? [];
    const zombies  = candidates.filter(c => c.reason === 'zombie');
    const orphans  = candidates.filter(c => c.reason === 'orphan');
    const idles    = candidates.filter(c => c.reason === 'idle_dev');

    if (zombies.length > 0) {
        alerts.push({
            text: `⚠  ${zombies.length} zombie process${zombies.length !== 1 ? 'es' : ''} — system will reap`,
            severity: 'high',
        });
    }
    if (orphans.length > 0) {
        alerts.push({
            text: `⚠  ${orphans.length} orphan process${orphans.length !== 1 ? 'es' : ''} running without a project`,
            severity: 'warn',
        });
    }
    for (const c of idles.slice(0, 2)) {
        const name = _cleanName(c.name);
        const idle = c.idleMs != null ? _formatDuration(c.idleMs) : '?';
        alerts.push({
            text: `⚠  ${name}  idle for ${idle}`,
            severity: 'warn',
        });
    }

    return alerts.slice(0, 5);
}

function _cleanName(name) {
    if (!name) return 'process';
    const n = name.replace(/.*\//, '');
    if (/^python\d*(\.\d+)?$/.test(n)) return 'Python server';
    if (/^node$/.test(n))              return 'Node server';
    return n;
}

function _formatDuration(ms) {
    if (!ms) return '';
    if (ms < 60_000)     return `${Math.floor(ms / 1000)}s`;
    if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m`;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function _addSep(menu) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}
