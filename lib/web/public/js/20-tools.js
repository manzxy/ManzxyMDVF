/* ═══════════════════════════════════════════════════════════════════════
   ALAT BANTU
   Command palette, undo, heatmap, live log, panic mode, audit log, API key, sesi.
   ───────────────────────────────────────────────────────────────────────
   Bagian dari bundle panel. Server menggabungkan js/*.js berurutan menjadi
   /panel/app.js, jadi browser tetap memuat SATU file (1 request).
   Urutan ditentukan awalan angka pada nama file. Semua modul berbagi satu
   skop global — jangan menambah "use strict" di sini (sudah di 00-core.js).
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── voucher topup ───────────── */

async function redeemVoucher() {
    const code = $('voucher-code').value.trim().toUpperCase();
    if (!code) return toast('Tulis kode voucher dulu.');
    try {
        const d = await api('/api/topup/voucher', { method: 'POST', body: { code } });
        toast(`🎟️ Voucher berhasil — +${d.amountText} masuk! Saldo: ${d.balanceText}`);
        $('voucher-code').value = '';
        refreshMe();
    } catch (err) { toast(err.message); }
}

async function loadVouchers() {
    const el = $('v-list');
    if (!el) return;
    try {
        const d = await api('/api/admin/voucher');
        el.innerHTML = (d.rows || []).length ? d.rows.map((v) => `
            <div class="session-row">
              <span class="session-main"><b class="mono">${esc(v.code)}</b>
                <small>${v.amountText} · terpakai ${v.uses}/${v.maxUses} · ${esc(v.expiresText)}${v.habis ? ' · HABIS' : ''}</small></span>
              <button class="btn btn-sm btn-danger-soft" data-delv="${esc(v.code)}" title="Hapus voucher">✕</button>
            </div>`).join('') : '<p class="empty">Belum ada voucher.</p>';
    } catch (err) { el.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

async function createVoucher() {
    const body = {
        code: $('v-code').value.trim().toUpperCase(),
        amount: Number($('v-amount').value) || 0,
        maxUses: Number($('v-uses').value) || 1,
        expiresDays: Number($('v-days').value) || 0
    };
    try {
        const d = await api('/api/admin/voucher', { method: 'POST', body });
        toast(`Voucher ${d.code} dibuat (${d.amountText}) 🎟️`);
        $('v-code').value = ''; $('v-amount').value = '';
        loadVouchers();
    } catch (err) { toast(err.message); }
}

async function deleteVoucher(code) {
    try {
        await api('/api/admin/voucher/delete', { method: 'POST', body: { code } });
        toast('Voucher dihapus.');
        loadVouchers();
    } catch (err) { toast(err.message); }
}

/* ───────────── backup database ───────────── */

async function loadBackups() {
    const el = $('backup-list');
    if (!el) return;
    try {
        const d = await api('/api/admin/backup/list');
        el.innerHTML = (d.rows || []).length ? d.rows.map((b) => `
            <div class="session-row"><span class="session-main"><b class="mono">${esc(b.file)}</b>
              <small>${esc(b.atText)} · ${esc(b.sizeText)}</small></span></div>`).join('')
            : '<p class="empty">Belum ada snapshot.</p>';
    } catch (err) { el.innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
}

async function downloadBackup() {
    try {
        const res = await fetch('/api/admin/backup', { headers: { Authorization: 'Bearer ' + Store.token } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Gagal membuat backup.');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = res.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] || 'backup.json.gz';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        toast('Backup diunduh 💾');
        loadBackups();
    } catch (err) { toast(err.message); }
}

/* ───────────── widget embed ───────────── */

let widgetCode = '';

function renderWidget() {
    const codeEl = $('pf-widget-code');
    const prev = $('pf-widget-preview');
    if (!codeEl) return;
    const key = ME?.account?.apiKey;
    if (!key) { codeEl.textContent = '— buat API key dulu —'; prev.innerHTML = ''; widgetCode = ''; return; }
    widgetCode = `<img src="${location.origin}/api/widget/saldo.svg?key=${key}" alt="saldo" height="28">`;
    codeEl.textContent = widgetCode;
    prev.innerHTML = `<img src="/api/widget/saldo.svg?key=${key}" alt="badge saldo" height="28"> <img src="/api/widget/bots.svg?key=${key}" alt="badge bot" height="28">`;
}

async function copyWidget() {
    if (!widgetCode) return toast('Buat API key dulu.');
    try { await navigator.clipboard.writeText(widgetCode); toast('Kode embed disalin 🧩'); } catch { toast('Gagal menyalin.'); }
}

/* ───────────── preview template broadcast ───────────── */

function bcPreview() {
    const el = $('bc-preview');
    if (!el) return;
    const t = $('bc-text').value;
    if (!t.includes('{')) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    el.innerHTML = '<b>Preview:</b> ' + esc(t
        .replace(/{nama}/gi, 'Budi')
        .replace(/{saldo}/gi, 'Rp50.000')
        .replace(/{tanggal}/gi, new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })));
}

/* ───────────── skeleton loading ───────────── */

const skeletonRows = (n = 3, cls = 'sk-row') =>
    Array.from({ length: n }, () => `<div class="${cls} skeleton" aria-hidden="true"></div>`).join('');

/* ───────────── command palette (Ctrl+K / tombol ?) ───────────── */

let paletteItems = [];
let paletteIdx = 0;

function paletteCommands() {
    const isAdmin = Boolean(ME?.account?.isAdmin);
    const pages = [
        ['dashboard', '📊 Dashboard'], ['monitor', '📡 Monitor'], ['jadibot', '🤖 Jadibot'],
        ['premium', '⭐ Premium'], ['referral', '🎁 Referral'], ['topup', '💰 Topup Saldo'],
        ['orders', '🧾 Transaksi'], ['profile', '👤 Profil']
    ];
    if (isAdmin) pages.push(['owner', '👑 Owner'], ['system', '💻 Sistem'], ['database', '🗄️ Database'], ['logs', '📜 Live Log']);
    const items = pages.map(([id, label]) => ({ label, hint: 'halaman', run: () => switchPage(id) }));
    items.push(
        { label: '⟳ Muat ulang semua data', hint: 'aksi', run: () => { refreshMe(); toast('Data dimuat ulang.'); } },
        { label: '🔔 Notifikasi browser: ' + (notifPref() ? 'matikan' : 'aktifkan'), hint: 'aksi', run: () => { const b = $('pf-notif'); if (b) { b.checked = !notifPref(); toggleNotifications(); } } },
        { label: '🚪 Keluar (logout)', hint: 'aksi', run: () => logout(false) }
    );
    if (isAdmin) items.push({ label: '🚨 Panic mode (jeda semua bot)', hint: 'owner', run: togglePanic });
    items.push(
        { label: '🌐 Bahasa: Indonesia/English', hint: 'tema', run: () => setLang(LANG === 'id' ? 'en' : 'id') },
        { label: '🎓 Putar tur pengenalan', hint: 'bantuan', run: startTour }
    );
    return items;
}

function openPalette() {
    $('palette').classList.remove('hidden');
    const inp = $('palette-in');
    inp.value = '';
    paletteIdx = 0;
    renderPalette('');
    inp.focus();
}

function closePalette() { $('palette').classList.add('hidden'); }

function renderPalette(q) {
    const list = $('palette-list');
    const query = String(q || '').trim().toLowerCase();
    paletteItems = paletteCommands().filter((c) => !query || c.label.toLowerCase().includes(query));
    if (!paletteItems.length) { list.innerHTML = '<p class="empty">Tidak ada hasil.</p>'; return; }
    paletteIdx = Math.min(paletteIdx, paletteItems.length - 1);
    list.innerHTML = paletteItems.map((c, i) =>
        `<button class="palette-item${i === paletteIdx ? ' active' : ''}" role="option" data-i="${i}"><span>${esc(c.label)}</span><small>${c.hint}</small></button>`).join('');
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}

function runPaletteItem(i) {
    const c = paletteItems[i];
    if (!c) return;
    closePalette();
    try { c.run(); } catch (e) { toast(e.message); }
}

/* ───────────── undo: tunda eksekusi aksi berbahaya 5 detik ───────────── */

function undoable(label, fn, { seconds = 5 } = {}) {
    return new Promise((resolve) => {
        const t = $('toast');
        let left = seconds;
        let timer = null;
        const finish = (run) => {
            if (timer) { clearInterval(timer); timer = null; }
            t.onclick = null;
            t.classList.add('hidden');
            if (run) {
                try { Promise.resolve(fn()).catch((e) => toast(e.message)); } catch (e) { toast(e.message); }
            } else {
                toast('Dibatalkan — tidak ada yang dijalankan.');
            }
            resolve(Boolean(run));
        };
        const tick = () => {
            t.innerHTML = `⏳ ${esc(label)} dalam <b>${left}s</b> — <button class="btn btn-xs undo-btn" type="button"><span class=\"ic\">↩</span> URUNGKAN</button>`;
            t.classList.remove('hidden');
        };
        t.onclick = (e) => { if (e.target.closest?.('.undo-btn')) finish(false); };
        tick();
        timer = setInterval(() => {
            left -= 1;
            if (left <= 0) finish(true);
            else tick();
        }, 1000);
    });
}

/* ───────────── heatmap aktivitas 7 hari ───────────── */

async function renderHeatmap() {
    const el = $('heatmap');
    if (!el) return;
    try {
        const d = await api('/api/heatmap');
        const max = d.max || 1;
        el.innerHTML = d.grid.map((row, r) =>
            `<div class="hm-row"><span class="hm-label">${esc(d.labels[r])}</span>` +
            row.map((c, h) => {
                const v = c.messages + c.commands;
                const lvl = v === 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((v / max) * 4)));
                return `<i class="hm-cell l${lvl}" title="${v} pesan · jam ${String(h).padStart(2, '0')}:00"></i>`;
            }).join('') + '</div>'
        ).join('');
    } catch { el.innerHTML = '<p class="empty">Gagal memuat heatmap.</p>'; }
}

/* ───────────── live log viewer (owner) ───────────── */

let logSource = null;
let logPaused = false;
let logFilter = 'all';
let logSearch = '';
let logLines = [];

const fmtClock = (t) => new Date(t).toLocaleTimeString('id-ID', { hour12: false });

function renderLogLines() {
    const view = $('log-view');
    if (!view) return;
    const q = logSearch.trim().toLowerCase();
    let rows = logFilter === 'all' ? logLines : logLines.filter((l) => l.level === logFilter);
    if (q) rows = rows.filter((l) => (l.text || '').toLowerCase().includes(q));
    const nearBottom = view.scrollTop + view.clientHeight >= view.scrollHeight - 60;
    view.innerHTML = rows.map((l) => {
        const tagCls = l.tag ? ` tag-${l.tag.replace(/[^A-Z0-9]/gi, '')}` : '';
        const body = l.tag ? esc(l.msg ?? l.text) : esc(l.text);
        const badge = l.tag ? `<span class="log-tag">${esc(l.tag)}</span>` : '';
        const levelCls = /^(info|warn|error|debug|success)$/i.test(String(l.level || '')) ? l.level : 'info';
        return `<div class="log-line ${levelCls}${tagCls}"><span class="log-t">${esc(fmtClock(l.t))}</span>${badge}${body}</div>`;
    }).join('') || `<p class="empty">${q ? 'Tidak ada baris yang cocok.' : 'Belum ada baris.'}</p>`;
    if (nearBottom) view.scrollTop = view.scrollHeight;   // auto-scroll kalau user memang di bawah
}

async function openLogs() {
    try {
        const d = await api('/api/admin/console?limit=300');
        logLines = d.rows || [];
        renderLogLines();
        $('log-stat').textContent = `info ${d.stats?.info || 0} · warn ${d.stats?.warn || 0} · error ${d.stats?.error || 0}`;
    } catch (err) { toast(err.message); }
    startLogStream();
}

function startLogStream() {
    stopLogStream();
    try {
        logSource = new EventSource('/api/admin/console/stream');
        logSource.onmessage = (e) => {
            if (logPaused) return;
            try { logLines.push(JSON.parse(e.data)); if (logLines.length > 300) logLines.splice(0, logLines.length - 300); renderLogLines(); } catch {}
        };
    } catch { /* EventSource tidak tersedia */ }
}

function stopLogStream() { if (logSource) { logSource.close(); logSource = null; } }

function toggleLogPause() {
    logPaused = !logPaused;
    $('btn-log-pause').textContent = logPaused ? '▶ LANJUT' : '⏸ JEDA';
    if (!logPaused) renderLogLines();
}

/* ───────────── panic mode (owner) ───────────── */

function renderPanic() {
    const on = Boolean(ME?.panic);
    $('panic-banner')?.classList.toggle('hidden', !on);
    const state = $('panic-state');
    const btn = $('btn-panic');
    if (state) {
        state.textContent = on ? '🚨 AKTIF — pesan ditolak (kecuali root owner)' : 'OFF — bot normal';
        state.className = 'panic-state ' + (on ? 'on' : 'off');
    }
    if (btn) {
        btn.textContent = on ? 'MATIKAN PANIC MODE' : 'AKTIFKAN PANIC MODE';
        btn.className = 'btn btn-block mt-sm ' + (on ? '' : 'btn-danger');
    }
}

async function togglePanic() {
    const on = !ME?.panic;
    if (on && !(await askConfirm('Aktifkan PANIC MODE? Semua pesan masuk ditolak kecuali dari root owner.', { title: 'PANIC MODE', ok: 'YA, JEDA BOT', danger: true }))) return;
    try {
        const d = await api('/api/admin/panic', { method: 'POST', body: { on } });
        ME.panic = d.panic;
        renderPanic();
        toast(on ? 'Panic mode AKTIF 🚨 Bot dijeda.' : 'Panic mode dimatikan. Bot normal kembali.');
    } catch (err) { toast(err.message); }
}

/* ───────────── audit log + revert (owner) ───────────── */

const AUDIT_LABELS = {
    slots: 'Slot jadibot', packages: 'Harga/paket', promo_free_jadibot: 'Promo jadibot gratis',
    promo_free_slots: 'Slot gratis', promo_discount: 'Diskon', panic: 'Panic mode', user_balance: 'Saldo user'
};

async function refreshAudit() {
    const el = $('audit-list');
    if (!el) return;
    try {
        const d = await api('/api/admin/audit');
        const rows = d.rows || [];
        if (!rows.length) { el.innerHTML = '<p class="empty">Belum ada perubahan pengaturan tercatat.</p>'; return; }
        el.innerHTML = rows.map((a) => `
            <div class="audit-row">
              <span class="audit-act">${esc(AUDIT_LABELS[a.action] || a.action)}</span>
              <span class="audit-detail">
                <small>${esc(a.actor)} · ${esc(a.atText)}</small>
                <small class="mono">${esc(JSON.stringify(a.before))} → ${esc(JSON.stringify(a.after))}</small>
              </span>
              ${a.revertable ? `<button class="btn btn-sm" data-revert="${a.id}" title="Kembalikan ke nilai sebelumnya">↩</button>` : ''}
            </div>`).join('');
    } catch (err) { toast(err.message); }
}

async function revertAudit(id) {
    try {
        await api('/api/admin/audit/revert', { method: 'POST', body: { id } });
        toast('Pengaturan dikembalikan ↩');
        refreshAudit();
    } catch (err) { toast(err.message); }
}

/* ───────────── personal API key ───────────── */

function renderApiKey() {
    const el = $('pf-apikey');
    if (!el) return;
    const key = ME?.account?.apiKey || '';
    el.textContent = key ? key.slice(0, 8) + '••••••••' + key.slice(-4) : 'belum ada — buat dulu';
}

async function apiKeyAction(action) {
    if (action === 'revoke' && !(await askConfirm('Cabut API key? Skrip yang pakai key ini akan berhenti bekerja.', { ok: 'YA, CABUT', danger: true }))) return;
    try {
        const d = await api('/api/profile/apikey', { method: 'POST', body: { action } });
        ME.account.apiKey = d.key || '';
        if (action === 'generate' && d.key) {
            renderApiKey();
            $('pf-apikey').textContent = d.key;          // tampilkan penuh sekali agar bisa disalin
            try { await navigator.clipboard.writeText(d.key); toast('API key dibuat & disalin 📋'); }
            catch { toast('API key dibuat — salin manual dari kotak.'); }
        } else {
            renderApiKey();
            toast(action === 'revoke' ? 'API key dicabut.' : 'OK.');
        }
        renderWidget();
    } catch (err) { toast(err.message); }
}

async function copyApiKey() {
    const key = ME?.account?.apiKey || '';
    if (!key) return toast('Belum ada API key. Buat dulu.');
    try { await navigator.clipboard.writeText(key); toast('API key disalin 📋'); }
    catch { $('pf-apikey').textContent = key; toast('Salin manual dari kotak.'); }
}

/* ───────────── export / import sesi jadibot ───────────── */

async function exportMySession() {
    const num = String(ME?.account?.waNumber || '').replace(/[^0-9]/g, '');
    if (!num) return toast('Verifikasi nomor WhatsApp dulu di Profil.');
    try {
        const res = await fetch(`/api/jadibot/export?number=${num}`, { headers: { Authorization: 'Bearer ' + Store.token } });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Gagal mengunduh sesi.');
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `sesi-${num}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
        toast('Backup sesi diunduh 💾 — simpan baik-baik, isinya login akun bot.');
    } catch (err) { toast(err.message); }
}

async function importMySession() {
    const f = $('sesi-file')?.files?.[0];
    if (!f) return toast('Pilih file backup sesi dulu.');
    if (f.size > 12 * 1024 * 1024) return toast('File terlalu besar (maks 12 MB).');
    let data;
    try { data = JSON.parse(await f.text()); } catch { return toast('File bukan JSON yang valid.'); }
    if (data.format !== 'manzxy-session-v1' || !data.files?.['creds.json']) return toast('File bukan backup sesi yang valid.');
    const num = String(ME?.account?.waNumber || '').replace(/[^0-9]/g, '');
    if (!num) return toast('Verifikasi nomor WhatsApp dulu di Profil.');
    if (!(await askConfirm(`Pulihkan sesi untuk +${num}? Sesi lama di nomor itu akan ditimpa.`, { ok: 'YA, PULIHKAN' }))) return;
    try {
        const d = await api('/api/jadibot/import', { method: 'POST', body: { number: num, files: data.files } });
        toast(`Sesi dipulihkan (${d.files} file)${d.started ? ' & langsung dinyalakan ✅' : ' — tekan NYALAKAN di Monitor.'}`);
        refreshMonitor();
    } catch (err) { toast(err.message); }
}

async function api(path, opts = {}) {
    const doFetch = (tok) => fetch(path, {
        method: opts.method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    let tok = Store.token;
    let res = await doFetch(tok);
    // Token lama di localStorage bisa basi (sesi server sudah dicabut) sementara cookie masih valid.
    // Buang token basi lalu coba lagi sekali dengan cookie sesi.
    if (res.status === 401 && tok) {
        Store.token = null;
        res = await doFetch(null);
    }
    // Server bisa merotasi token sesi (umur > 7 hari) — simpan yang baru.
    const renewed = res.headers.get('X-Session-Token');
    if (renewed) Store.token = renewed;
    let data = {};
    try { data = await res.json(); } catch {}
    if (res.status === 401) { logout(true); throw new Error('Sesi berakhir, silakan login ulang.'); }
    if (!res.ok) throw new Error(data.error || 'HTTP ' + res.status);
    return data;
}

