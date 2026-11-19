/* ═══════════════════════════════════════════════════════════════════════
   TAMPILAN
   Perpindahan view, halaman owner, halaman sistem, editor paket.
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── view switching ───────────── */

function showAuth() {
    $('view-auth').classList.remove('hidden');
    $('view-app').classList.add('hidden');
    // baca error dari OAuth callback
    const q = new URLSearchParams(location.search);
    if (q.get('oauth_error')) {
        showAuthMsg('error', 'Login ' + 'gagal: ' + q.get('oauth_error'));
        history.replaceState(null, '', window.location.pathname);
    } else if (q.get('oauth_ok')) {
        showAuthMsg('ok', 'Berhasil masuk lewat OAuth 🎉');
        history.replaceState(null, '', window.location.pathname);
    }

    // Link undangan (?ref=KODE) → langsung isi kode & buka tab daftar
    const ref = (q.get('ref') || '').trim().toUpperCase();
    if (ref) {
        const inp = $('reg-ref');
        if (inp) inp.value = ref;
        setAuthTab('register');
        checkRefCode(ref);
    }
}

function enterApp(token) {
    if (token) Store.token = token;
    $('view-auth').classList.add('hidden');
    $('view-app').classList.remove('hidden');
    switchPage('dashboard');
    refreshMe();
    startEvents();
    // preferensi tersimpan lokal diterapkan segera (server menyusul via /api/me)
    try { applyLang(localStorage.getItem('mz_lang') || 'id'); } catch {}
    // tur onboarding sekali saja
    let done = false;
    try { done = localStorage.getItem('mz_tour_done') === '1'; } catch {}
    if (!done) setTimeout(startTour, 900);
}

/* ───────────── halaman owner ───────────── */

async function applyOwnerTab() {
    const isAdmin = Boolean(ME?.account?.isAdmin);
    for (const id of ['tab-owner', 'tab-database', 'tab-system', 'tab-logs']) {
        const tab = $(id);
        if (tab) tab.classList.toggle('hidden', !isAdmin);
    }
    // pembungkus grup ADMIN: sembunyikan seluruhnya kalau bukan admin
    const group = $('side-admin');
    if (group) group.classList.toggle('hidden', !isAdmin);
    // kalau sedang di halaman owner/database tapi bukan admin lagi, keluar dari halaman itu
    if (!isAdmin) {
        const active = document.querySelector('.tab.active')?.dataset.page;
        if (active === 'owner' || active === 'database' || active === 'system' || active === 'logs') switchPage('dashboard');
    }
}

async function refreshOwner() {
    if (!ME?.account?.isAdmin) return;
    try {
        const [ov, accs, logs] = await Promise.all([
            api('/api/admin/overview'),
            api('/api/admin/accounts'),
            api('/api/admin/logs')
        ]);
        renderOwnerOverview(ov);
        renderOwnerAccounts(accs.accounts || []);
        renderOwnerLogs(logs.logs || []);
        refreshRevenue();
        refreshOwnerUsers();
        refreshAudit();
        renderPanic();
        loadDailyReport();
        pollBroadcast();
        loadVouchers();
        loadBackups();
    } catch (err) { toast(err.message); }
    refreshOauthSettings();
}

/* ───────────── login OAuth & alamat panel (owner) ─────────────
 * Kredensial Google/GitHub dan base URL panel diatur dari web ini,
 * tidak perlu menyentuh .env maupun restart bot.
 */

async function refreshOauthSettings() {
    if (!ME?.account?.isAdmin) return;
    let d;
    try { d = await api('/api/admin/oauth'); } catch (err) { return toast(err.message); }

    $('oa-base').value = d.baseUrl || '';
    const envNote = d.envBaseUrl ? ` — env saat ini: ${d.envBaseUrl}` : '';
    $('oa-base').placeholder = `https://panel.manzxy.biz.id${envNote}`;

    for (const id of ['google', 'github']) {
        const p = d.providers?.[id] || {};
        $(`oa-${id}-id`).value = p.clientId || '';
        // secret tidak pernah dikirim balik — kosongkan & beri petunjuk
        $(`oa-${id}-secret`).value = '';
        $(`oa-${id}-secret`).placeholder = p.hasSecret ? '••••••••  (tersimpan — kosongkan bila tidak diubah)' : '••••••••';
        $(`oa-${id}-uri`).textContent = p.redirectUri || '-';
        const badge = $(`oa-${id}-badge`);
        badge.textContent = p.enabled ? 'AKTIF' : 'BELUM AKTIF';
        badge.className = 'badge ' + (p.enabled ? 'on' : 'off');
    }
}

async function saveOauthProvider(provider) {
    const btn = $(`btn-save-${provider}`);
    const clientId = ($(`oa-${provider}-id`).value || '').trim();
    const clientSecret = ($(`oa-${provider}-secret`).value || '').trim();
    if (!clientId || !clientSecret) {
        return showOauthMsg('error', 'Isi Client ID dan Client Secret dulu, lalu simpan.');
    }
    btn.disabled = true; btn.textContent = 'MENYIMPAN…';
    try {
        await api('/api/admin/oauth', {
            method: 'POST',
            body: { baseUrl: ($('oa-base').value || '').trim(), [provider]: { clientId, clientSecret } }
        });
        showOauthMsg('ok', `Login ${provider === 'google' ? 'Google' : 'GitHub'} tersimpan & aktif ✅`);
        await refreshOauthSettings();
    } catch (err) {
        showOauthMsg('error', err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = `SIMPAN ${provider.toUpperCase()}`;
    }
}

function showOauthMsg(kind, text) {
    const el = $('oa-msg');
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${kind === 'ok' ? 'green' : 'red'}">${esc(text)}</div>`;
}

function renderOwnerOverview(ov) {
    ov = ov || {};
    // API bisa mengirim payload parsial (mis. server lama / sesi owner belum lengkap).
    // Jangan sampai satu field hilang mematikan seluruh halaman owner.
    const slots = ov.slots || {};
    const promo = ov.promo || {};
    const disc = promo.discounts || {};
    const stats = ov.stats || {};

    $('ad-slots-used').textContent = `${slots.used ?? 0}/${slots.max ?? 0}`;
    $('ad-slots-reg').textContent = slots.registered ?? 0;
    $('ad-slots-online').textContent = slots.online ?? 0;
    $('ad-max').value = slots.max ?? 0;
    $('ad-maxper').value = slots.maxPerUser ?? 0;

    renderOwnerPackages(ov.packages || { perDay: 0, list: [] });

    $('ad-free-usage').textContent = `${promo.freeUsage ?? 0}/${promo.freeSlots ?? 0} slot`;
    $('ad-free-on').checked = Boolean(promo.freeJadibot);
    $('ad-free-slots').value = promo.freeSlots ?? 0;
    $('ad-disc-jadibot').value = disc.jadibot || 0;
    $('ad-disc-rent').value = disc.rent || 0;
    $('ad-disc-prem').value = disc.prem || 0;

    $('ad-st-users').textContent = stats.users ?? 0;
    $('ad-st-prem').textContent = stats.premium ?? 0;
    $('ad-st-banned').textContent = stats.banned ?? 0;
    $('ad-st-balance').textContent = fmtRp(stats.balanceTotal ?? 0);
}

/* ───────────── halaman SISTEM: spek server + grafik ─────────────
 * Data dari /api/admin/sysinfo (spek, non-pribadi) dan
 * /api/admin/sysinfo/history (deret angka beban untuk grafik).
 * Rick: tidak ada nomor/email/IP/path yang ditampilkan di sini.
 */

let sysTimer = null;
let sysRange = 15;              // menit yang ditampilkan; 0 = semua
let sysHistory = [];

const fmtBytes = (n) => {
    n = Number(n) || 0;
    if (!n) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
    return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};

const fmtDur = (s) => {
    s = Math.max(0, Math.floor(Number(s) || 0));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    const p = [];
    if (d) p.push(d + ' hari');
    if (d || h) p.push(h + ' jam');
    if (d || h || m || !d) p.push(m + ' mnt');
    return p.join(' ');
};

/** Set bar meter + kelas warna sesuai tingkat beban. */
function setMeter(barId, percent, invert = false) {
    const el = $(barId);
    if (!el) return;
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    el.style.width = p + '%';
    const hot = invert ? p <= 10 : p >= 90;
    const warn = invert ? p <= 30 : p >= 70;
    el.className = hot ? 'hot' : warn ? 'warn' : 'ok';
}

/** Ambil riwayat untuk rentang terpilih. */
function rangePoints() {
    const pts = sysHistory || [];
    if (!sysRange || !pts.length) return pts;
    const cutoff = Date.now() - sysRange * 60_000;
    return pts.filter((p) => p.t >= cutoff);
}

/**
 * Gambar grafik garis + area ke dalam <svg class="spark">.
 * viewBox tetap 320x70, diskalakan CSS supaya responsif.
 */
function drawSpark(svg, points, metric, { div = 1, minZero = true } = {}) {
    if (!svg) return;
    const W = 320, H = 70, PAD = 4;
    const vals = points.map((p) => Number(p[metric])).filter((v) => Number.isFinite(v));
    const NS = 'http://www.w3.org/2000/svg';

    if (vals.length < 2) {
        svg.innerHTML = '';
        return;
    }

    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (minZero) lo = Math.min(lo, 0);
    if (hi === lo) { hi = lo + 1; }
    // beri sedikit ruang atas/bawah supaya garis tidak menempel tepi
    const span = hi - lo || 1;
    hi += span * 0.08;
    if (!minZero) lo -= span * 0.08;

    const x = (i) => PAD + (i / (vals.length - 1)) * (W - PAD * 2);
    const y = (v) => H - PAD - ((v - lo) / (hi - lo)) * (H - PAD * 2);

    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(vals.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;

    svg.innerHTML = `
        <line class="gridline" x1="0" y1="${(H / 2).toFixed(0)}" x2="${W}" y2="${(H / 2).toFixed(0)}"/>
        <path class="area" d="${area}"/>
        <path class="line" d="${line}"/>
        <circle class="dot" cx="${x(vals.length - 1).toFixed(1)}" cy="${y(vals[vals.length - 1]).toFixed(1)}" r="2.6"/>
    `;
    return { lo, hi };
}

/** Tulis now/min/max/avg untuk satu grafik. */
function fillStats(key, values, unit, div = 1) {
    const fmt = (v) => (v === null || v === undefined || !Number.isFinite(v))
        ? '-'
        : `${(v / div).toFixed(div === 1 ? (unit === '°C' ? 0 : 2) : 2).replace(/\.00$/, '')}${unit ? ' ' + unit : ''}`;
    const clean = values.filter((v) => Number.isFinite(v));
    const now = clean.length ? clean[clean.length - 1] : null;
    const min = clean.length ? Math.min(...clean) : null;
    const max = clean.length ? Math.max(...clean) : null;
    const avg = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null;

    if ($(`g-${key}-now`)) $(`g-${key}-now`).textContent = fmt(now);
    if ($(`g-${key}-min`)) $(`g-${key}-min`).textContent = fmt(min);
    if ($(`g-${key}-max`)) $(`g-${key}-max`).textContent = fmt(max);
    if ($(`g-${key}-avg`)) $(`g-${key}-avg`).textContent = fmt(avg);
}

function renderSysGraphs() {
    const pts = rangePoints();
    const nodata = $('sys-nodata');
    if (nodata) nodata.classList.toggle('hidden', pts.length >= 2);

    const specs = [
        { key: 'load', metric: 'loadPct', unit: '%' },
        { key: 'mem', metric: 'memPct', unit: '%' },
        { key: 'rss', metric: 'botRssKB', unit: 'MB', div: 1024 },
        { key: 'temp', metric: 'temp', unit: '°C' }    ];

    document.querySelectorAll('.sys-graph').forEach((el) => {
        const metric = el.dataset.metric;
        const spec = specs.find((s) => s.metric === metric) || {};
        const svg = el.querySelector('.spark');
        drawSpark(svg, pts, metric);
    });

    specs.forEach((s) => {
        const values = pts.map((p) => (p[s.metric] === null ? NaN : Number(p[s.metric])));
        fillStats(s.key, values, s.unit, s.div || 1);
    });
}

/**
 * Tulis teks ke elemen dengan aman.
 * Mencegah error "Cannot read properties of null (reading 'textContent')"
 * kalau HTML dan JS sempat tidak sinkron (mis. cache browser versi lama).
 */
function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
    return el;
}

/** Set kelas pada elemen bila elemen ada. */
function setClass(id, cls) {
    const el = $(id);
    if (el) el.className = cls;
    return el;
}

/** Render seluruh halaman sistem dari data spek. */
function renderSysinfo(d) {
    const h = d.host || {}, c = d.cpu || {}, mem = d.memory || {}, rt = d.runtime || {};

    setText('sys-env', (h.environment?.label || '-').toUpperCase());
    setText('sys-os', h.os || '-');
    setText('sys-sub', `Kernel ${h.kernel || '-'}  ·  ${c.bits || h.arch || '-'}  ·  Node ${rt.node || '-'}`);
    setText('sys-up-sys', fmtDur(rt.uptimeSystem));
    setText('sys-up-bot', fmtDur(rt.uptimeBot));

    // CORE: CPU
    const ld = (k) => Number(c.load?.[k] ?? 0) || 0;
    const load1 = ld('l1');
    const cores = Number(c.cores) || 0;
    const loadPct = cores ? (load1 / cores) * 100 : 0;
    setText('sys-cpu-val', load1.toFixed(2));
    setMeter('sys-cpu-bar', Math.min(100, loadPct));
    const cpuFoot = $('sys-cpu-foot');
    if (cpuFoot) {
        if (cores && load1 > cores) {
            cpuFoot.textContent = `⚠ overload ${loadPct.toFixed(0)}% dari ${cores} core`;
            cpuFoot.className = 'sys-card-foot alert';
        } else {
            cpuFoot.textContent = cores ? `${loadPct.toFixed(0)}% dari ${cores} core` : `load ${load1.toFixed(2)}`;
            cpuFoot.className = 'sys-card-foot';
        }
    }

    // CORE: RAM
    setText('sys-ram-val', `${(mem.percent || 0).toFixed(0)}%`);
    setMeter('sys-ram-bar', mem.percent || 0);
    setText('sys-ram-foot', `${fmtBytes(mem.used)} / ${fmtBytes(mem.total)}`);

    // CORE: DISK
    const disks = d.disk || [];
    const main = disks[0];
    if (main) {
        setText('sys-disk-val', `${main.percent}%`);
        setMeter('sys-disk-bar', main.percent);
        setText('sys-disk-foot', `${fmtBytes(main.used)} / ${fmtBytes(main.total)}, sisa ${fmtBytes(main.avail)}`);
    } else {
        setText('sys-disk-val', '-');
        setText('sys-disk-foot', 'tidak terdeteksi');
    }

    // CORE: SUHU
    const temp = Number(c.temp);
    if (Number.isFinite(temp) && temp > 0) {
        setText('sys-temp-val', `${temp}°C`);
        // bar suhu: 0°C..100°C, dibalik biar "penuh" = dingin-tidak, kita pakai langsung
        setMeter('sys-temp-bar', temp);
        setText('sys-temp-foot', temp >= 80 ? '⚠ panas' : temp >= 65 ? 'hangat' : 'normal');
    } else {
        setText('sys-temp-val', '-');
        setMeter('sys-temp-bar', 0);
        setText('sys-temp-foot', 'sensor tidak tersedia');
    }

    // DETAIL: prosesor
    setText('sys-cpu-model', c.model || '-');
    setText('sys-cpu-core', `${c.cores || 0} core`);
    setText('sys-cpu-mhz', c.mhz ? `${c.mhz} MHz` : '-');
    setText('sys-cpu-arch', `${c.arch || '-'} (${c.bits || '-'})`);
    setText('sys-cpu-load', `${load1.toFixed(2)} / ${ld('l5').toFixed(2)} / ${ld('l15').toFixed(2)}`);

    // DETAIL: memori
    setText('sys-ram-total', fmtBytes(mem.total));
    setText('sys-ram-used', `${fmtBytes(mem.used)} (${(mem.percent || 0).toFixed(1)}%)`);
    setText('sys-ram-free', fmtBytes(mem.free));
    setText('sys-ram-bot', rt.rss ? fmtBytes(rt.rss) : '-');
    setText('sys-ram-heap', rt.heapUsed ? `${fmtBytes(rt.heapUsed)} / ${fmtBytes(rt.heapTotal)}` : '-');

    // DETAIL: penyimpanan
    $('sys-disks').innerHTML = disks.length ? disks.map((x) => `
        <div class="sys-disk">
          <div class="sys-disk-top"><span>${esc(x.label || '-')}</span><em>${x.percent}%</em></div>
          <div class="meter"><i class="${x.percent >= 90 ? 'hot' : x.percent >= 70 ? 'warn' : 'ok'}" style="width:${Math.min(100, x.percent)}%"></i></div>
          <span class="sys-disk-foot">${fmtBytes(x.used)} / ${fmtBytes(x.total)} · sisa ${fmtBytes(x.avail)}</span>
        </div>`).join('') : '<p class="empty">Tidak terdeteksi</p>';

    // DETAIL: runtime
    setText('sys-node', rt.node || '-');
    setText('sys-platform', `${h.platform || '-'} ${h.arch ? '(' + h.arch + ')' : ''}`.trim());
    setText('sys-osarch', c.bits || h.arch || '-');
    setText('sys-portcount', d.ports?.count ?? '-');
}

async function refreshSysinfo(notify = false) {
    if (!ME?.account?.isAdmin) return;
    try {
        const [snap, hist] = await Promise.all([
            api('/api/admin/sysinfo'),
            api('/api/admin/sysinfo/history')
        ]);
        renderSysinfo(snap);
        sysHistory = hist.points || [];
        renderSysGraphs();
        await refreshTraffic();
        if (notify) toast('Data sistem diperbarui');
    } catch (err) {
        toast(err.message);
    }
}

function toggleSysAuto() {
    const autoEl = $('sys-auto');
    if (!autoEl) return;
    const on = autoEl.checked;
    clearInterval(sysTimer);
    sysTimer = null;
    if (!on) return;
    sysTimer = setInterval(() => {
        const active = document.querySelector('.tab.active')?.dataset.page;
        if (active !== 'system') {
            $('sys-auto').checked = false;
            toggleSysAuto();
            return;
        }
        refreshSysinfo();
    }, 10_000);
    refreshSysinfo();
}


/* ── trafik per jam: bar chart ── */

let trafHours = 24;
let trafData = null;

/**
 * Gambar bar chart dua seri (pesan & command) ke dalam <svg>.
 * viewBox 640x160; setiap jam satu kelompok dua batang.
 */
function drawTrafficBars(svg, series) {
    if (!svg) return;

    const W = 640, H = 160, PAD_L = 26, PAD_B = 18, PAD_T = 8, PAD_R = 4;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;

    if (!series.length) { svg.innerHTML = ''; return; }

    const maxVal = Math.max(1, ...series.map((s) => Math.max(s.messages, s.commands)));
    // bulatkan ke atas supaya sumbu Y enak dibaca
    const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(maxVal))));
    const yMax = Math.ceil(maxVal / step) * step;

    const groupW = plotW / series.length;
    const barW = Math.max(1.5, Math.min(9, groupW * 0.32));
    const gap = Math.max(0.5, barW * 0.22);

    const yOf = (v) => PAD_T + plotH - (v / yMax) * plotH;

    const parts = [];

    // gridline + label sumbu Y (0, tengah, atas)
    for (const frac of [0, 0.5, 1]) {
        const v = yMax * frac;
        const y = yOf(v).toFixed(1);
        parts.push(`<line class="gridline" x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}"/>`);
        parts.push(`<text class="axis" x="${PAD_L - 5}" y="${(Number(y) + 3).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`);
    }

    series.forEach((s, i) => {
        const cx = PAD_L + groupW * i + groupW / 2;
        const hMsg = (s.messages / yMax) * plotH;
        const hCmd = (s.commands / yMax) * plotH;

        if (hMsg > 0) {
            parts.push(`<rect class="bar bar-msg" x="${(cx - barW - gap / 2).toFixed(2)}" y="${(PAD_T + plotH - hMsg).toFixed(2)}" width="${barW.toFixed(2)}" height="${hMsg.toFixed(2)}"><title>${esc(s.label)} · ${s.messages} pesan</title></rect>`);
        }
        if (hCmd > 0) {
            parts.push(`<rect class="bar bar-cmd" x="${(cx + gap / 2).toFixed(2)}" y="${(PAD_T + plotH - hCmd).toFixed(2)}" width="${barW.toFixed(2)}" height="${hCmd.toFixed(2)}"><title>${esc(s.label)} · ${s.commands} command</title></rect>`);
        }

        // label jam: tampilkan tiap N jam supaya tidak berdesakan
        const every = Math.ceil(series.length / 12);
        if (i % every === 0) {
            parts.push(`<text class="axis" x="${cx.toFixed(1)}" y="${H - 5}" text-anchor="middle">${esc(s.label)}</text>`);
        }
    });

    svg.innerHTML = parts.join('');
}

function renderTraffic(d) {
    trafData = d;
    const series = d.series || [];
    const hasData = series.some((s) => s.messages > 0 || s.commands > 0);

    $('traf-msg-total').textContent = (d.totals?.messages || 0).toLocaleString('id-ID');
    $('traf-cmd-total').textContent = (d.totals?.commands || 0).toLocaleString('id-ID');
    $('traf-msg-all').textContent = (d.allTime?.messages || 0).toLocaleString('id-ID');
    $('traf-cmd-all').textContent = (d.allTime?.commands || 0).toLocaleString('id-ID');

    drawTrafficBars($('sys-bars'), series);
    const nd = $('traf-nodata');
    if (nd) nd.classList.toggle('hidden', hasData);
}

async function refreshTraffic() {
    if (!ME?.account?.isAdmin) return;
    try {
        renderTraffic(await api(`/api/admin/sysinfo/traffic?hours=${trafHours}`));
    } catch (err) {
        toast(err.message);
    }
}

/* ── editor paket durasi jadibot ── */

let pkgDraft = [];

function renderOwnerPackages(packages) {
    pkgDraft = (packages.list || []).map((p) => ({ ...p }));
    $('ad-perday').value = packages.perDay || 0;
    drawPkgEditor();
}

function drawPkgEditor() {
    const el = $('ad-packages');
    el.innerHTML = pkgDraft.map((p, i) => `
        <div class="pkg-row">
          <input class="inp pkg-inp-label" data-i="${i}" data-f="label" value="${esc(p.label)}" placeholder="nama (mis. MINGGUAN)">
          <input class="inp pkg-inp-days" data-i="${i}" data-f="days" value="${esc(p.days)}" type="number" min="1" max="3650" title="hari">
          <input class="inp pkg-inp-price" data-i="${i}" data-f="price" value="${esc(p.price)}" type="number" min="0" title="harga Rp">
          <button class="btn btn-sm btn-danger-soft" data-pkg="del" data-i="${i}" type="button">✕</button>
        </div>`).join('') || '<p class="empty">Belum ada paket — tambahkan di bawah.</p>';
}

function pkgInputEvents(e) {
    const inp = e.target.closest('.pkg-row input');
    if (inp) {
        const i = Number(inp.dataset.i), f = inp.dataset.f;
        if (pkgDraft[i]) pkgDraft[i][f] = f === 'label' ? inp.value : Number(inp.value);
        return;
    }
    const btn = e.target.closest('[data-pkg]');
    if (btn?.dataset.pkg === 'del') {
        pkgDraft.splice(Number(btn.dataset.i), 1);
        drawPkgEditor();
    }
}

function addPackageRow() {
    pkgDraft.push({ label: `PAKET ${pkgDraft.length + 1}`, days: 30, price: 10000 });
    drawPkgEditor();
}

async function savePackages() {
    const list = pkgDraft.map((p) => ({ label: String(p.label).trim(), days: Number(p.days), price: Number(p.price) }));
    if (!list.length) return toast('Minimal satu paket.');
    for (const p of list) {
        if (!p.label) return toast('Ada paket tanpa nama.');
        if (!Number.isInteger(p.days) || p.days < 1) return toast(`Durasi paket "${p.label}" tidak valid.`);
        if (!Number.isInteger(p.price) || p.price < 0) return toast(`Harga paket "${p.label}" tidak valid.`);
    }
    try {
        await api('/api/admin/packages', {
            method: 'POST',
            body: { packages: list, perDay: Number($('ad-perday').value) }
        });
        toast('Paket durasi disimpan — langsung berlaku.');
        refreshOwner(); refreshMe();
    } catch (err) { toast(err.message); }
}

async function saveSlots() {
    try {
        const r = await api('/api/admin/slots', {
            method: 'POST',
            body: { max: Number($('ad-max').value), maxPerUser: Number($('ad-maxper').value) }
        });
        toast(`Slot disimpan: ${r.slots.max} total, ${r.slots.maxPerUser}/user`);
        refreshOwner();
    } catch (err) { toast(err.message); }
}

async function savePromo() {
    try {
        await api('/api/admin/promo', {
            method: 'POST',
            body: {
                freeJadibot: $('ad-free-on').checked,
                freeSlots: Number($('ad-free-slots').value),
                discounts: {
                    jadibot: Number($('ad-disc-jadibot').value),
                    rent: Number($('ad-disc-rent').value),
                    prem: Number($('ad-disc-prem').value)
                }
            }
        });
        toast('Promo & diskon disimpan');
        refreshOwner();
    } catch (err) { toast(err.message); }
}

async function refreshOwnerUsers() {
    try {
        const q = $('ad-user-q').value.trim();
        const r = await api('/api/admin/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
        const el = $('ad-users');
        if (!(r.users || []).length) { el.innerHTML = '<p class="empty">Tidak ada pengguna cocok.</p>'; return; }
        el.innerHTML = r.users.map((u) => `
            <div class="admin-row">
              <div class="admin-main">
                <strong>+${esc(u.number)}</strong> ${u.online ? '<span class="dot-on"></span>' : ''}
                <small>${esc(u.name || '(tanpa nama)')} • ${esc(u.role.toUpperCase())}${u.premium ? ' • ⭐ ' + esc(u.premiumText) : ''}${u.banned ? ' • 🚫 BANNED' : ''}</small>
                <small>Saldo ${esc(u.balanceText)} • Lv ${u.level} • ${u.messages} pesan • terlihat ${esc(u.lastSeenText)}</small>
              </div>
              <div class="admin-actions">
                <button class="btn btn-sm" data-adm="saldo" data-num="${esc(u.number)}" data-cur="${u.balance}">+SALDO</button>
                <button class="btn btn-sm" data-adm="prem" data-num="${esc(u.number)}">+PREM</button>
                ${u.premium ? `<button class="btn btn-sm" data-adm="unprem" data-num="${esc(u.number)}">CABUT PREM</button>` : ''}
                ${u.banned
                    ? `<button class="btn btn-sm" data-adm="unban" data-num="${esc(u.number)}">UNBAN</button>`
                    : `<button class="btn btn-sm btn-danger-soft" data-adm="ban" data-num="${esc(u.number)}">BAN</button>`}
              </div>
            </div>`).join('');
    } catch (err) { toast(err.message); }
}

async function adminUserAction(action, number, extra = {}) {
    let body = { number, action, ...extra };
    if (action === 'saldo') {
        const input = prompt('Tambah saldo (boleh minus untuk kurangi, contoh 5000 atau -2000):', '5000');
        if (input === null) return;
        body.amount = Number(input);
        if (!Number.isFinite(body.amount) || body.amount === 0) return toast('Nominal tidak valid.');
    }
    if (action === 'prem') {
        const input = prompt('Premium berapa hari?:', '30');
        if (input === null) return;
        body.days = Number(input);
        if (!Number.isFinite(body.days) || body.days <= 0) return toast('Durasi tidak valid.');
        action = 'setPremium';
        body = { number, action, days: body.days };
    }
    if (action === 'ban') {
        await undoable(`Ban +${number}`, async () => {
            const r = await api('/api/admin/user', { method: 'POST', body });
            toast(`+${number}: ${r.detail}`);
            refreshOwnerUsers();
        });
        return;
    }
    try {
        const r = await api('/api/admin/user', { method: 'POST', body });
        toast(`+${number}: ${r.detail}`);
        refreshOwnerUsers();
    } catch (err) { toast(err.message); }
}

function renderOwnerAccounts(accounts) {
    const el = $('ad-accounts');
    if (!accounts.length) { el.innerHTML = '<p class="empty">Belum ada akun panel.</p>'; return; }
    el.innerHTML = accounts.map((a) => `
        <div class="admin-row">
          <div class="admin-main">
            <strong>${esc(a.displayName || a.email || '#' + a.id)}</strong>
            <small>${esc(a.email || '(tanpa email)')} • +${esc(a.waNumber || '-')} • ${esc(a.role.toUpperCase())}</small>
            <small>Daftar ${esc(a.createdText)} • login terakhir ${esc(a.lastLoginText)}</small>
          </div>
          <div class="admin-actions">
            <button class="btn btn-sm" data-acc="role" data-id="${a.id}" data-role="${a.role === 'owner' ? 'user' : 'owner'}">${a.role === 'owner' ? 'JADI USER' : 'JADI OWNER'}</button>
            <button class="btn btn-sm btn-danger-soft" data-acc="del" data-id="${a.id}">HAPUS</button>
          </div>
        </div>`).join('');
}

function renderOwnerLogs(logs) {
    const el = $('ad-logs');
    if (!logs.length) { el.innerHTML = '<p class="empty">Belum ada aktivitas.</p>'; return; }
    el.innerHTML = logs.map((l) => `
        <div class="log-row">
          <span>${esc(l.action)} <small>${esc(l.detail)}</small></span>
          <small>${esc(l.who)} • ${esc(l.ip || '-')} • ${esc(l.atText)}</small>
        </div>`).join('');
}

async function adminAccountAction(action, id, role) {
    if (action === 'del') {
        await undoable('Menghapus akun panel', async () => {
            await api('/api/admin/account', { method: 'POST', body: { id: Number(id), action: 'delete' } });
            toast('Akun panel dihapus.');
            refreshOwner();
        });
        return;
    }
    try {
        await api('/api/admin/account', { method: 'POST', body: { id: Number(id), action: 'setRole', role } });
        toast('Berhasil.');
        refreshOwner();
    } catch (err) { toast(err.message); }
}

async function onBoot() {
    // service worker: panel tetap terbuka saat internet putus (hanya di HTTPS/localhost)
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('/panel/sw.js').catch(() => {});
    }

    // cek dulu provider OAuth mana yang aktif (untuk tombol)
    try {
        const p = await api('/api/auth/providers');
        applyProviders(p.providers);
        const any = Object.entries(p.providers).some(([, v]) => v.enabled);
        if (!any) document.querySelector('.or-divider')?.classList.add('hidden');
    } catch {}

    // Coba masuk dengan token tersimpan ATAU cookie sesi (token bisa sudah basi).
    try { await api('/api/me'); enterApp(null); return; } catch {}
    // Token tersimpan gagal → pastikan dibuang supaya tidak terus menimpa cookie
    Store.token = null;
    try { await api('/api/me'); enterApp(null); return; } catch {}
    showAuth();
}

function applyProviders(providers) {
    for (const [id, v] of Object.entries(providers || {})) {
        const btn = $('btn-' + id);
        if (!btn) continue;
        if (!v.enabled) btn.classList.add('oauth-disabled');
        btn.setAttribute('data-enabled', v.enabled ? '1' : '0');
        btn.title = v.enabled ? `Masuk dengan ${v.label}` : `${v.label} belum dikonfigurasi`;
    }
}

function logout(soft) {
    if (!soft) { try { fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + Store.token } }); } catch {} }
    stopEvents();
    Store.token = null;
    ME = null; MON = null;
    showAuth();
}

function switchPage(name) {
    // penjaga: tombol tanpa data-page tidak boleh menyembunyikan semua halaman
    if (!name) return;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.page === name));
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('hidden', p.id !== 'page-' + name));
    // judul di topbar mengikuti halaman aktif (modul 45-shell)
    if (typeof syncPageChrome === 'function') syncPageChrome(name);
    if (name === 'monitor') refreshMonitor();
    if (name === 'orders') { refreshOrders(); if (typeof clearFeedBadge === 'function') clearFeedBadge(); }
    if (name === 'jadibot') updateJadibotPage();
    if (name === 'sewa') refreshSewa();
    if (name === 'commands') refreshCommands();
    if (name === 'premium') refreshPremium();
    if (name === 'referral') refreshReferral();
    if (name === 'profile') renderProfile();
    if (name === 'owner') refreshOwner();
    if (name === 'system') refreshSysinfo();
    if (name !== 'system' && sysTimer) { $('sys-auto').checked = false; toggleSysAuto(); }
    if (name === 'database') refreshDbPage();
    if (name === 'logs') openLogs();
    else stopLogStream();
    if (name === 'referral') renderLeaderboard();
    window.scrollTo(0, 0);
}

