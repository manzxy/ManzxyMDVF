/* ═══════════════════════════════════════════════════════════════════════
   SHELL — perilaku kerangka (sidebar, drawer, bottom nav, judul halaman)
   ───────────────────────────────────────────────────────────────────────
   Dimuat setelah 40-views.js (switchPage) dan sebelum 60-boot.js, supaya
   switchPage sudah ada saat modul ini dipasang.

   Yang diatur di sini:
   • buka/tutup drawer di tablet & HP
   • judul halaman di topbar mengikuti tab aktif
   • saldo tampil di dua tempat (sidebar & topbar) — satu sumber data
   • Escape / klik scrim menutup drawer
   • drawer otomatis tertutup saat layar melebar ke desktop
   ═══════════════════════════════════════════════════════════════════════ */

/* ───────────── label halaman ───────────── */

const PAGE_META = {
    dashboard: { title: 'Dashboard', sub: 'Ringkasan bot & akun' },
    monitor: { title: 'Monitor', sub: 'Status jadibot real-time' },
    jadibot: { title: 'Jadibot', sub: 'Kelola sub-bot Anda' },
    commands: { title: 'Katalog Command', sub: 'Semua perintah bot' },
    whatsnew: { title: "What's New", sub: 'Update terbaru & fitur langka' },
    premium: { title: 'Premium', sub: 'Paket & langganan' },
    referral: { title: 'Referral', sub: 'Ajak teman, dapat saldo' },
    topup: { title: 'Topup Saldo', sub: 'Isi saldo akun' },
    orders: { title: 'Transaksi', sub: 'Riwayat pembayaran' },
    profile: { title: 'Profil', sub: 'Akun & keamanan' },
    owner: { title: 'Owner', sub: 'Panel administrator' },
    system: { title: 'Sistem', sub: 'Beban server & runtime' },
    database: { title: 'Database', sub: 'Jelajahi data bot' },
    logs: { title: 'Log', sub: 'Log langsung dari bot' }
};

function syncPageChrome(name) {
    const meta = PAGE_META[name] || { title: name, sub: '' };
    const crumb = $('page-crumb');
    const sub = $('page-sub');
    if (crumb) crumb.textContent = meta.title;
    if (sub) sub.textContent = meta.sub;
    // judul dokumen ikut berubah: enak saat banyak tab terbuka
    try { document.title = `${meta.title} · ManzxyMD`; } catch {}
}

/* ───────────── drawer (tablet & HP) ───────────── */

function sideOpen() {
    const side = $('sidebar');
    const scrim = $('side-scrim');
    if (!side) return;
    side.classList.add('open');
    if (scrim) {
        scrim.hidden = false;
        // paksa reflow supaya transisi opacity berjalan
        void scrim.offsetWidth;
        scrim.classList.add('show');
    }
    document.documentElement.classList.add('nav-open');
    const first = side.querySelector('.tab');
    if (first) { try { first.focus({ preventScroll: true }); } catch {} }
}

function sideClose() {
    const side = $('sidebar');
    const scrim = $('side-scrim');
    if (!side) return;
    side.classList.remove('open');
    document.documentElement.classList.remove('nav-open');
    if (scrim) {
        scrim.classList.remove('show');
        // sembunyikan setelah transisi selesai
        setTimeout(() => { if (!side.classList.contains('open')) scrim.hidden = true; }, 220);
    }
}

function sideToggle() {
    const side = $('sidebar');
    if (!side) return;
    side.classList.contains('open') ? sideClose() : sideOpen();
}

/* ───────────── saldo: satu sumber, dua tempat ───────────── */

function setBalanceText(text) {
    for (const id of ['hdr-balance', 'hdr-balance-top']) {
        const el = $(id);
        if (el) el.textContent = text;
    }
}

/* ───────────── pemasangan ───────────── */

(function initShell() {
    // tombol menu (topbar) & "Lainnya" (bottom nav)
    for (const id of ['btn-side-open', 'btn-side-open-2']) {
        const b = $(id);
        if (b) b.addEventListener('click', (e) => { e.preventDefault(); sideToggle(); });
    }
    const closeBtn = $('btn-side-close');
    if (closeBtn) closeBtn.addEventListener('click', sideClose);

    const scrim = $('side-scrim');
    if (scrim) scrim.addEventListener('click', sideClose);

    // Escape menutup drawer
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && $('sidebar')?.classList.contains('open')) sideClose();
    });

    // klik menu di drawer/bottom nav: tutup drawer lalu pindah halaman
    document.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab[data-page]');
        if (!tab) return;
        if ($('sidebar')?.classList.contains('open')) sideClose();
    });

    // layar melebar ke desktop: drawer tidak relevan lagi
    if (window.matchMedia) {
        const mq = window.matchMedia('(min-width: 1024px)');
        const onChange = () => { if (mq.matches) sideClose(); };
        if (mq.addEventListener) mq.addEventListener('change', onChange);
        else if (mq.addListener) mq.addListener(onChange);
    }

    // judul halaman awal
    syncPageChrome('dashboard');
})();
