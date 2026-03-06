/**
 * DevWatch — ui/snapshotSection.js  (v3)
 *
 * Section: "Dev Sessions"
 *
 * Save, restore, and delete workspace snapshots.
 * Phase 4: inline naming entry, Resuming… feedback, Autosave label alias.
 */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { _ } from '../utils/i18n.js';

const SECTION_TAG = 'devwatch-snapshots';
const MAX_ROWS = 5;

export function buildSnapshotSection(menu, snapshots, callbacks) {
    clearSnapshotSection(menu);
    const { onSave, onRestore, onDelete } = callbacks ?? {};

    // Collapsible sub-menu: "Sessions  [Save]"
    const sub = new PopupMenu.PopupSubMenuMenuItem('', false);
    sub._devwatchSection = SECTION_TAG;

    // ── Header row: "Sessions"  [Save] ─────────────────────────────────────
    const headerRow = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    headerRow.add_child(new St.Label({ text: _('Sessions'), style_class: 'dw-section-label', x_expand: true }));

    const saveBtn = new St.Button({
        label: _('Save'),
        style_class: 'dw-section-action',
        reactive: true, can_focus: true, track_hover: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    headerRow.add_child(saveBtn);

    sub.label.get_parent().insert_child_above(headerRow, sub.label);
    sub.label.hide();

    // ── Inline naming row (hidden until Save is clicked) ──────────────────
    const namingItem = new PopupMenu.PopupMenuItem('', { reactive: false });
    namingItem.add_style_class_name('dw-snap-naming-row');
    const namingBox = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    namingBox.spacing = 6;

    const entry = new St.Entry({
        hint_text: _('Session name…'),
        style_class: 'dw-snap-entry',
        x_expand: true,
        can_focus: true,
    });
    entry.clutter_text.set_max_length(40);

    const confirmBtn = new St.Button({
        label: '✓',
        style_class: 'dw-section-action',
        reactive: true, can_focus: true, track_hover: true,
    });
    const cancelBtn = new St.Button({
        label: '✕',
        style_class: 'dw-btn-delete',
        reactive: true, can_focus: true, track_hover: true,
    });

    namingBox.add_child(entry);
    namingBox.add_child(confirmBtn);
    namingBox.add_child(cancelBtn);
    namingItem.add_child(namingBox);
    namingItem.label.hide();
    namingItem._devwatchSection = SECTION_TAG;

    const _showNaming = () => {
        saveBtn.reactive = false;
        saveBtn.opacity  = 80;
        entry.set_text('');
        namingItem.visible = true;
        // Focus the text entry after layout settles
        entry.grab_key_focus();
    };
    const _hideNaming = () => {
        namingItem.visible = false;
        saveBtn.reactive = true;
        saveBtn.opacity  = 255;
    };

    saveBtn.connect('clicked', _showNaming);
    cancelBtn.connect('clicked', _hideNaming);
    confirmBtn.connect('clicked', () => {
        const label = entry.get_text().trim() || 'auto';
        _hideNaming();
        onSave?.(label);
    });
    // Also confirm on Enter key
    entry.clutter_text.connect('activate', () => {
        const label = entry.get_text().trim() || 'auto';
        _hideNaming();
        onSave?.(label);
    });

    menu.addMenuItem(sub);
    sub.menu.addMenuItem(namingItem, 0); // insert at top of sub-menu
    namingItem.visible = false;

    if (!snapshots || snapshots.length === 0) {
        const empty = new PopupMenu.PopupMenuItem(_('  No saved sessions yet — click Save'), { reactive: false });
        empty.label.style_class = 'dw-dim';
        sub.menu.addMenuItem(empty);
        _addSep(menu);
        return;
    }

    for (const snap of snapshots.slice(0, MAX_ROWS)) {
        sub.menu.addMenuItem(_buildRow(snap, onRestore, onDelete));
    }
    if (snapshots.length > MAX_ROWS) {
        const more = new PopupMenu.PopupMenuItem(`  … and ${snapshots.length - MAX_ROWS} older sessions`, { reactive: false });
        more.label.style_class = 'dw-dim';
        sub.menu.addMenuItem(more);
    }
    _addSep(menu);
}

export function clearSnapshotSection(menu) {
    for (const item of menu._getMenuItems().filter(i => i._devwatchSection === SECTION_TAG))
        item.destroy();
}

function _buildRow(snap, onRestore, onDelete) {
    const item = new PopupMenu.PopupMenuItem('', { reactive: false });
    const outer = new St.BoxLayout({ vertical: true, x_expand: true });
    outer.spacing = 2;

    // Line 1: name  ·  date
    const line1 = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    line1.spacing = 8;
    const displayLabel = (snap.label === 'auto' || !snap.label) ? 'Autosave' : snap.label;
    line1.add_child(new St.Label({ text: _truncate(displayLabel, 28), style_class: 'dw-snap-name', x_expand: true }));
    line1.add_child(new St.Label({ text: _formatDate(snap.savedAt), style_class: 'dw-snap-meta' }));
    outer.add_child(line1);

    // Line 2: meta summary  [Resume]  [Delete]
    const line2 = new St.BoxLayout({ x_expand: true, y_align: Clutter.ActorAlign.CENTER });
    line2.spacing = 6;

    const parts = [];
    if (snap.projectCount != null) parts.push(`${snap.projectCount} project${snap.projectCount !== 1 ? 's' : ''}`);
    if (snap.serviceCount)         parts.push(`${snap.serviceCount} service${snap.serviceCount !== 1 ? 's' : ''}`);
    if (snap.editorCount)          parts.push(`${snap.editorCount} editor${snap.editorCount   !== 1 ? 's' : ''}`);
    if (parts.length > 0) {
        line2.add_child(new St.Label({
            text: parts.join('  ·  '),
            style_class: 'dw-muted',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }

    const restoreBtn = new St.Button({
        label: 'Resume',
        style_class: 'dw-btn-load',
        reactive: true, can_focus: true, track_hover: true,
    });
    restoreBtn.connect('clicked', () => {
        restoreBtn.label    = 'Resuming…';
        restoreBtn.reactive = false;
        onRestore?.(snap.filename);
    });
    line2.add_child(restoreBtn);

    const delBtn = new St.Button({ label: 'Delete', style_class: 'dw-btn-delete', reactive: true, can_focus: true, track_hover: true });
    delBtn.connect('clicked', () => onDelete?.(snap.filename));
    line2.add_child(delBtn);

    outer.add_child(line2);
    item.add_child(outer);
    item.label.hide();
    return item;
}

function _formatDate(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
        if (isNaN(d.getTime())) return iso.slice(0, 16);
        const day   = String(d.getDate()).padStart(2, '0');
        const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
        return `${day} ${month}  ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } catch (_) { return iso.slice(0, 16); }
}
function _truncate(s, n) { return s && s.length > n ? s.slice(0, n - 1) + '…' : (s ?? ''); }
function _addSep(menu) {
    const sep = new PopupMenu.PopupSeparatorMenuItem();
    sep._devwatchSection = SECTION_TAG;
    menu.addMenuItem(sep);
}
