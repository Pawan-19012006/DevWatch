/**
 * DevWatch — Project-Aware Developer Intelligence Layer
 * Main extension entry point (GNOME 45+, ESM)
 *
 * Pillar 1 — Step 1: Scaffold
 *   • Registers a PanelMenu.Button with a status icon + label
 *   • Opens a dropdown with a static placeholder section
 *   • All UI is fully torn down in disable()
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export default class DevWatchExtension extends Extension {
    /**
     * One-time setup only — no UI here.
     */
    constructor(metadata) {
        super(metadata);
    }

    enable() {
        // ── Panel Indicator ────────────────────────────────────────────
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // Status dot + label in the top bar
        const box = new St.BoxLayout({
            style_class: 'devwatch-panel-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._statusDot = new St.Label({
            text: '●',
            style_class: 'devwatch-dot devwatch-dot-green',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._panelLabel = new St.Label({
            text: ' DevWatch',
            style_class: 'devwatch-panel-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(this._statusDot);
        box.add_child(this._panelLabel);
        this._indicator.add_child(box);

        // ── Dropdown (placeholder content — replaced in later steps) ───
        this._buildMenu();

        // ── Add to panel (right area, leftmost slot) ───────────────────
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');

        console.log('[DevWatch] Extension enabled');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
        this._statusDot = null;
        this._panelLabel = null;

        console.log('[DevWatch] Extension disabled');
    }

    // ── Private helpers ────────────────────────────────────────────────

    _buildMenu() {
        const menu = this._indicator.menu;

        // ── Header row ─────────────────────────────────────────────────
        const header = new PopupMenu.PopupMenuItem('DevWatch', { reactive: false });
        header.label.style_class = 'devwatch-menu-header';
        menu.addMenuItem(header);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Active Projects (placeholder) ──────────────────────────────
        const projectsTitle = new PopupMenu.PopupMenuItem('Active Projects', { reactive: false });
        projectsTitle.label.style_class = 'devwatch-section-title';
        menu.addMenuItem(projectsTitle);

        const noProjects = new PopupMenu.PopupMenuItem('  No projects detected yet', { reactive: false });
        noProjects.label.style_class = 'devwatch-dim';
        menu.addMenuItem(noProjects);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Active Ports (placeholder) ─────────────────────────────────
        const portsTitle = new PopupMenu.PopupMenuItem('Active Ports', { reactive: false });
        portsTitle.label.style_class = 'devwatch-section-title';
        menu.addMenuItem(portsTitle);

        const noPorts = new PopupMenu.PopupMenuItem('  No dev ports detected yet', { reactive: false });
        noPorts.label.style_class = 'devwatch-dim';
        menu.addMenuItem(noPorts);

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // ── Footer action ──────────────────────────────────────────────
        menu.addAction('Refresh', () => {
            console.log('[DevWatch] Manual refresh triggered');
        });
    }
}
