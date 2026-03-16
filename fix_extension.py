with open('extension.js', 'r') as f:
    text = f.read()

# 1. Imports
text = text.replace("import { CleanupEngine }        from './core/cleanupEngine.js';\n", "")
text = text.replace("import { buildCleanupSection }  from './ui/cleanupSection.js';\n", "")

# 2. Instantiations
text = text.replace("        this._cleanupEngine     = new CleanupEngine();\n", "")
text = text.replace("        this._cleanupEngine?.destroy();\n        this._cleanupEngine = null;\n", "")

# 3. Execution
old_analysis = """        // Run cleanup analysis
        const idleThresholdMinutes = this._settings?.get_int('idle-threshold-minutes') ?? 10;
        const portPids = new Set(
            (portResult.ports ?? []).filter(r => r.pid).map(r => r.pid)
        );
        const cleanupResult = this._cleanupEngine
            ? this._cleanupEngine.analyse(projectMap, portPids, idleThresholdMinutes)
            : { candidates: [], scannedAt: 0 };

"""
text = text.replace(old_analysis, "")

# 4. health summary
old_health = """        buildHealthSummary(
            this._indicator.menu,
            projectMap,
            portResult,
            cleanupResult,
            () => this._refresh().catch(e => this._logError(e)),
            () => this._stopAllProjects(),
            () => this._cleanEnvironment(cleanupResult)
        );"""
new_health = """        buildHealthSummary(
            this._indicator.menu,
            projectMap,
            portResult,
            () => this._refresh().catch(e => this._logError(e)),
            () => this._stopAllProjects()
        );"""
text = text.replace(old_health, new_health)

# 5. alerts section
text = text.replace("buildAlertsSection(this._indicator.menu, projectMap, portResult, cleanupResult);", "buildAlertsSection(this._indicator.menu, projectMap, portResult);")

# 6. buildCleanupSection
old_cleanup_ui = """        buildCleanupSection(
            this._indicator.menu,
            cleanupResult,
            pid => this._killProcess(pid, null)
        );"""
text = text.replace(old_cleanup_ui, "")

# 7. updateStatusDot
text = text.replace("this._updateStatusDot(projectMap, portResult, cleanupResult, buildResult);", "this._updateStatusDot(projectMap, portResult, buildResult);")

# 8. remove _cleanEnvironment
old_clean_env = """    /**
     * Kill all cleanup candidates (orphans + idle-dev; never zombies).
     * Triggered by the "Clean Dev Environment" quick-action button.
     * @param {{ candidates: object[] }} cleanupResult
     */
    _cleanEnvironment(cleanupResult) {
        const killable = (cleanupResult?.candidates ?? []).filter(c => c.reason !== 'zombie');
        for (const c of killable) {
            this._killProcess(c.pid, null);
        }
        // Immediately refresh so rows disappear
        this._refresh().catch(e => this._logError(e));
    }

"""
text = text.replace(old_clean_env, "")

# 9. _updateStatusDot signature and logic
import re
text = re.sub(r'     \* @param \{\{ candidates: object\[\] \}\} cleanupResult\n', '', text)
text = text.replace("        cleanupResult  = { candidates: [] },\n", "")

old_status_logic = """        const hasZombie    = cleanupResult.candidates.some(c => c.reason === 'zombie');
        const hasOrphan    = cleanupResult.candidates.some(c => c.reason === 'orphan');
        const hasConflict  = portResult.newPorts?.length > 0;
        const hasIdle      = cleanupResult.candidates.some(c => c.reason === 'idle_dev');
        const highCpu      = projectMap && [...projectMap.values()].some(p =>
            p.totalCpuPercent > 80
        );
        // A build hammering the CPU signals active work (yellow — not an error)
        const buildingHot  = buildResult.active?.some(r => r.peakCpuPct > 90);

        let dotClass = 'devwatch-dot-green';
        if (hasZombie || hasOrphan || hasConflict) dotClass = 'devwatch-dot-red';
        else if (highCpu || hasIdle || buildingHot) dotClass = 'devwatch-dot-yellow';"""

new_status_logic = """        const hasConflict  = portResult.newPorts?.length > 0;
        const highCpu      = projectMap && [...projectMap.values()].some(p =>
            p.totalCpuPercent > 80
        );
        // A build hammering the CPU signals active work (yellow — not an error)
        const buildingHot  = buildResult.active?.some(r => r.peakCpuPct > 90);

        let dotClass = 'devwatch-dot-green';
        if (hasConflict) dotClass = 'devwatch-dot-red';
        else if (highCpu || buildingHot) dotClass = 'devwatch-dot-yellow';"""
        
text = text.replace(old_status_logic, new_status_logic)

# 10. remove JS doc notes
text = text.replace(" *   • CleanupEngine   — zombie / orphan / idle-dev detection\n", "")
text = text.replace(" *   • buildCleanupSection — Clean All + per-candidate Kill\n", "")


with open('extension.js', 'w') as f:
    f.write(text)
