const fs = require('node:fs');
const path = require('node:path');

// Data yang ditulis bot sendiri tidak boleh memicu siklus restart.
const IGNORED_DIRS = new Set(['node_modules', 'session', 'session_zapo', 'sessions_jadibot', 'database', '.git', '.cache', 'coverage']);
const IGNORED_FILES = new Set(['verification-log.txt']);

function watchProject(root, onChange, { debounceMs = 450, ignoredDirs = IGNORED_DIRS, ignoredPaths = [] } = {}) {
    const excluded = ignoredPaths.map((entry) => path.resolve(root, entry));
    const watchers = new Map();
    let timer;
    let closed = false;

    function ignored(name, directory, full) {
        if (excluded.some((entry) => full === entry || full.startsWith(entry + path.sep))) return true;
        if (ignoredDirs.has(name) || name === '.git') return true;
        return directory ? false : IGNORED_FILES.has(name);
    }

    function scan(dir) {
        if (closed || watchers.has(dir)) return;
        let watcher;
        try {
            watcher = fs.watch(dir, (_event, filename) => {
                if (closed) return;
                // Beberapa platform tidak memberikan nama file; scan kembali direktori.
                if (!filename) return schedule(dir);
                const name = String(filename);
                const full = path.join(dir, name);
                let stat;
                try { stat = fs.statSync(full); } catch {}
                if (ignored(name, Boolean(stat?.isDirectory()), full)) return;
                if (stat?.isDirectory()) scan(full);
                else if (!stat && watchers.has(full)) removeTree(full);
                schedule(full);
            });
            watcher.on('error', (err) => {
                removeTree(dir);
                if (!closed) console.error(`[WATCH] ${dir}: ${err.message}`);
            });
            watchers.set(dir, watcher);
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory() && !ignored(entry.name, true, path.join(dir, entry.name))) scan(path.join(dir, entry.name));
            }
        } catch (err) {
            if (watcher) watcher.close();
            console.error(`[WATCH] ${dir}: ${err.message}`);
        }
    }

    function removeTree(dir) {
        for (const [watched, watcher] of watchers) {
            if (watched === dir || watched.startsWith(dir + path.sep)) {
                watcher.close();
                watchers.delete(watched);
            }
        }
    }

    function schedule(file) {
        clearTimeout(timer);
        timer = setTimeout(() => {
            if (!closed) onChange(path.relative(root, file) || '.');
        }, debounceMs);
    }

    scan(root);
    return () => {
        closed = true;
        clearTimeout(timer);
        for (const watcher of watchers.values()) watcher.close();
        watchers.clear();
    };
}

module.exports = { watchProject, IGNORED_DIRS };
