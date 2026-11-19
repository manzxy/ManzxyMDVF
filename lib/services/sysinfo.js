/**
 * lib/sysinfo.js — Spesifikasi server (CPU, RAM, disk, OS, jaringan, runtime).
 * Dipakai bersama oleh bot WA (.sysinfo) dan panel web (/api/admin/sysinfo).
 */
const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

const CACHE_MS = 5000;
let cache = { at: 0, data: null };

/** Jalankan perintah shell, kembalikan stdout atau '' kalau gagal. */
function sh(cmd, timeout = 4000) {
    try {
        return execSync(cmd, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '';
    }
}

function readFileSafe(p) {
    try { return fs.readFileSync(p, 'utf8').trim(); } catch { return ''; }
}

/** Nama OS cantik dari /etc/os-release (fallback Android/umum). */
function osPretty() {
    const rel = readFileSafe('/etc/os-release');
    const m = rel.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
    if (m) return m[1];
    if (process.platform === 'android') {
        const v = readFileSafe('/system/build.prop').match(/ro\.build\.version\.release=(\S+)/);
        return `Android${v ? ` ${v[1]}` : ''}`;
    }
    return `${os.type()} ${os.release()}`;
}

/** Model CPU asli: lscpu → /proc/cpuinfo → DMI. */
function cpuModel() {
    const cpus = os.cpus() || [];
    const raw = (cpus[0]?.model || '').replace(/\s+/g, ' ').trim();
    const plausible = (s) => !!s && /[a-z]{3,}/i.test(s) && !/^(unknown|\d+)$/i.test(s);

    if (plausible(raw)) return raw;

    const lscpu = sh('lscpu 2>/dev/null');
    const lm = lscpu.match(/^Model name:\s*(.+)$/mi);
    if (lm && plausible(lm[1])) return lm[1].trim();

    const proc = readFileSafe('/proc/cpuinfo');
    const pm = proc.match(/^(?:model name|Hardware|Processor)\s*:\s*(.+)$/mi);
    if (pm && plausible(pm[1])) return pm[1].trim();

    const dmi = readFileSafe('/sys/devices/virtual/dmi/id/product_name');
    const vendor = readFileSafe('/sys/devices/virtual/dmi/id/sys_vendor');
    if (plausible(dmi) || plausible(vendor)) return `${vendor} ${dmi}`.trim();

    return 'Tidak diketahui';
}

function cpuInfo() {
    const cpus = os.cpus() || [];
    const proc = readFileSafe('/proc/cpuinfo');
    const cores = cpus.length || Number(proc.match(/^processor\s*:/gm)?.length) || 0;
    return {
        model: cpuModel(),
        cores,
        mhz: cpus[0]?.speed || 0,
        arch: os.arch(),
        bits: os.machine ? os.machine() : os.arch()
    };
}

/** Disk per mount point dari `df -Pk`. */
/** Info disk tanpa spawn proses (fs.statfs) — dipakai sampling berkala.
 *  Fallback ke df bila statfs tidak tersedia/gagal (container aneh). */
async function diskInfoFast() {
    try {
        if (fs.promises.statfs) {
            const out = [];
            for (const mount of ['/', '.']) {
                try {
                    const st = await fs.promises.statfs(mount);
                    const total = st.blocks * st.bsize, free = st.bfree * st.bsize;
                    if (total > 0 && !out.some((d) => d.mount === mount)) {
                        out.push({ device: mount, mount, total, used: total - free, avail: free,
                            percent: Math.round(((total - free) / total) * 100) });
                    }
                } catch {}
            }
            if (out.length) return out;
        }
    } catch {}
    return diskInfo();          // fallback lama (execSync df)
}

function diskInfo() {
    const out = sh('df -Pk . / 2>/dev/null');
    if (!out) return [];
    const seen = new Set();
    const rows = [];
    for (const line of out.split('\n').slice(1)) {
        const cols = line.trim().split(/\s+/);
        if (cols.length < 6) continue;
        const [device, total, used, avail, percent, mount] = cols;
        if (seen.has(mount)) continue;
        if (!/^\d+$/.test(total)) continue;          // lewati tmpfs/header aneh
        seen.add(mount);
        rows.push({
            device,
            mount,
            total: Number(total) * 1024,
            used: Number(used) * 1024,
            avail: Number(avail) * 1024,
            percent: Number(String(percent).replace('%', '')) || 0
        });
    }
    return rows;
}

/** Lingkup eksekusi: Termux, container, atau VPS/bare-metal. */
function environmentInfo() {
    const isTermux = !!(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('com.termux'));
    const cgroup = readFileSafe('/proc/1/cgroup');
    const container = cgroup.match(/(docker|kubepods|lxc|containerd)/)?.[1];
    const isContainer = !!(container || fs.existsSync('/.dockerenv'));
    const provider = readFileSafe('/sys/devices/virtual/dmi/id/sys_vendor');
    return {
        isTermux,
        container: isContainer ? (container || 'docker') : null,
        label: isTermux ? 'Termux / Android' : isContainer ? `Container (${container || 'docker'})` : 'Bare-metal / VPS',
        provider: provider || null
    };
}

function networkInfo() {
    const nets = os.networkInterfaces() || {};
    const ipv4 = [];
    for (const [name, addrs] of Object.entries(nets)) {
        for (const a of addrs || []) {
            if (a.family === 'IPv4' && !a.internal) ipv4.push({ name, address: a.address });
        }
    }
    return { hostname: os.hostname(), ipv4 };
}

/** Port yang sedang listen (ss → netstat). */
function listeningPorts() {
    let out = sh('ss -ltnp 2>/dev/null | tail -n +2');
    if (!out) out = sh('netstat -ltnp 2>/dev/null | tail -n +3');
    if (!out) return [];
    const ports = new Set();
    for (const line of out.split('\n')) {
        const m = line.trim().split(/\s+/).find((c) => /:\d+$/.test(c));
        if (m) ports.add(Number(m.split(':').pop()));
    }
    return [...ports].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
}

/** Suhu CPU (kalau sensor tersedia). */
function cpuTemp() {
    const raw = readFileSafe('/sys/class/thermal/thermal_zone0/temp');
    if (/^\d+$/.test(raw)) return Math.round(Number(raw) / 1000);
    return null;
}

/**
 * Spesifikasi lengkap server. Hasil di-cache singkat supaya aman dipanggil berulang.
 */
function snapshot() {
    const now = Date.now();
    if (cache.data && now - cache.at < CACHE_MS) return cache.data;

    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const mem = process.memoryUsage();
    const load = os.loadavg();

    const data = {
        at: new Date().toISOString(),
        host: {
            os: osPretty(),
            kernel: os.release(),
            platform: process.platform,
            arch: cpuInfo().bits,
            hostname: os.hostname(),
            environment: environmentInfo()
        },
        cpu: { ...cpuInfo(), load: { 1: load[0], 5: load[1], 15: load[2] }, temp: cpuTemp() },
        memory: {
            total: totalMem,
            used: usedMem,
            free: freeMem,
            percent: totalMem ? (usedMem / totalMem) * 100 : 0
        },
        disk: diskInfo(),
        network: { ...networkInfo(), ports: listeningPorts() },
        runtime: {
            node: process.version,
            pid: process.pid,
            cwd: process.cwd(),
            rss: mem.rss,
            heapUsed: mem.heapUsed,
            heapTotal: mem.heapTotal,
            uptimeBot: Math.floor(process.uptime()),
            uptimeSystem: Math.floor(os.uptime())
        }
    };

    cache = { at: now, data };
    return data;
}

/**
 * Riwayat metrik ringan untuk grafik panel web.
 * Disimpan di memori (maks MAX_POINTS titik, ~1 jam pada interval 15 detik).
 * Hanya berisi angka agregat — tidak ada data pribadi pengguna.
 */
const HISTORY_INTERVAL_MS = 15_000;
const MAX_POINTS = 240;                 // 240 × 15s = 60 menit
const history = [];
let historyTimer = null;

async function historyPoint() {
    const totalMem = os.totalmem();
    const usedMem = totalMem - os.freemem();
    const load1 = os.loadavg()[0];
    const cores = (os.cpus() || []).length || 1;
    const mem = process.memoryUsage();
    const disks = await diskInfoFast();
    const main = disks.find((d) => d.mount === '/') || disks[0];
    return {
        t: Date.now(),
        load1,
        loadPct: Math.min(100, (load1 / cores) * 100),
        cores,
        memPct: totalMem ? (usedMem / totalMem) * 100 : 0,
        memUsed: usedMem,
        memTotal: totalMem,
        botRss: mem.rss,
        botHeap: mem.heapUsed,
        diskPct: main ? main.percent : 0,
        temp: cpuTemp()
    };
}

/** Mulai sampling berkala (idempoten — aman dipanggil berkali-kali). */
function startHistory() {
    if (historyTimer) return;
    const tick = async () => {
        try {
            history.push(await historyPoint());
            if (history.length > MAX_POINTS) history.splice(0, history.length - MAX_POINTS);
        } catch { /* sampling gagal tidak boleh mematikan bot */ }
    };
    tick();
    historyTimer = setInterval(() => tick().catch(() => {}), HISTORY_INTERVAL_MS);
    if (historyTimer.unref) historyTimer.unref();
}

/** Salinan riwayat (tanpa referensi internal). */
function historySeries() {
    startHistory();
    return history.map((p) => ({ ...p }));
}

/**
 * Versi aman untuk ditampilkan di web.
 * Membuang: path filesystem, PID, nama host internal, IP, port, device disk,
 * dan seluruh data pengguna. Hanya menyisakan spek perangkat + angka agregat.
 */
function publicSnapshot() {
    const s = snapshot();
    return {
        at: s.at,
        host: {
            os: s.host.os,
            kernel: s.host.kernel,
            platform: s.host.platform,
            arch: s.host.arch,
            environment: { label: s.host.environment.label, provider: s.host.environment.provider }
        },
        cpu: {
            model: s.cpu.model,
            cores: s.cpu.cores,
            mhz: s.cpu.mhz,
            arch: s.cpu.arch,
            bits: s.cpu.bits,
            load: { l1: s.cpu.load[1] ?? s.cpu.load['1'], l5: s.cpu.load[5] ?? s.cpu.load['5'], l15: s.cpu.load[15] ?? s.cpu.load['15'] },
            temp: s.cpu.temp
        },
        memory: s.memory,
        // disk: tanpa nama device & tanpa mount path lengkap (hanya label ringkas)
        disk: s.disk.map((d) => ({
            label: d.mount === '/' ? 'Sistem (/)' : d.mount.replace(/^\/.*\//, '.../'),
            total: d.total,
            used: d.used,
            avail: d.avail,
            percent: d.percent
        })),
        // runtime: tanpa PID & cwd
        runtime: {
            node: s.runtime.node,
            rss: s.runtime.rss,
            heapUsed: s.runtime.heapUsed,
            heapTotal: s.runtime.heapTotal,
            uptimeBot: s.runtime.uptimeBot,
            uptimeSystem: s.runtime.uptimeSystem
        },
        // port listen sengaja tidak dikirim: bisa membocorkan topologi layanan
        ports: { count: s.network.ports.length }
    };
}

module.exports = { snapshot, publicSnapshot, historySeries, startHistory, sh, readFileSafe };
