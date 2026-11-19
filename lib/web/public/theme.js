/* Tema awal — dipasang SEBELUM render supaya tidak kedip terang→gelap.
 * Mode: 'light' | 'dark' | 'system' (tersimpan di localStorage 'mz_theme_mode').
 * 'system' mengikuti prefers-color-scheme secara langsung (tanpa ditulis ke atribut),
 * supaya satu set CSS [data-theme] dipakai untuk light & dark. */
(function () {
    var KEY = 'mz_theme_mode';
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function readMode() {
        var t = null;
        try { t = localStorage.getItem(KEY); } catch (e) {}
        // migrasi dari kunci lama (light/dark)
        if (t !== 'light' && t !== 'dark' && t !== 'system') {
            try {
                var old = localStorage.getItem('mz_theme');
                if (old === 'light' || old === 'dark') t = old;
            } catch (e) {}
        }
        return t || 'system';
    }

    function resolved(mode) {
        if (mode === 'dark') return 'dark';
        if (mode === 'light') return 'light';
        return (mq && mq.matches) ? 'dark' : 'light';
    }

    function apply() {
        var mode = readMode();
        document.documentElement.setAttribute('data-theme', resolved(mode));
        document.documentElement.setAttribute('data-theme-mode', mode);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', resolved(mode) === 'dark' ? '#0b1220' : '#FFE500');
    }

    // API kecil untuk tombol switch di app.js
    window.ManzxyTheme = {
        mode: readMode,
        set: function (mode) {
            if (mode !== 'light' && mode !== 'dark' && mode !== 'system') mode = 'system';
            try { localStorage.setItem(KEY, mode); } catch (e) {}
            apply();
        },
        apply: apply
    };

    if (mq && mq.addEventListener) mq.addEventListener('change', function () { if (readMode() === 'system') apply(); });
    apply();
})();
