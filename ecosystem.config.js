module.exports = {
    apps: [
        {
            name: 'ManzxyMD',
            script: './scripts/dev.js',
            node_args: '--expose-gc',
            instances: 1,                 // satu sesi WhatsApp hanya boleh dipakai satu proses
            exec_mode: 'fork',            // JANGAN cluster: jadibot tidak boleh jalan di banyak proses
            autorestart: true,
            watch: false,                 // supervisor memantau seluruh source; data runtime dikecualikan
            restart_delay: 3000,
            exp_backoff_restart_delay: 100,
            max_memory_restart: '1500M',
            env: {
                NODE_ENV: 'production',
                PORT: 3000,

                /* ── Panel web ──
                 * Alamat publik panel. WAJIB diisi supaya redirect OAuth benar
                 * dan cookie sesi ditandai Secure di belakang HTTPS.
                 */
                WEB_PANEL_URL: 'https://panel.manzxy.biz.id',

                /* ── Login OAuth ──
                 * Redirect URI yang harus didaftarkan di provider:
                 *   https://panel.manzxy.biz.id/api/auth/google/callback
                 *   https://panel.manzxy.biz.id/api/auth/github/callback
                 *
                 * Kosongkan bila belum dipakai — tombol provider otomatis nonaktif.
                 */
                GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
                GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
                GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || '',
                GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || '',

                /* ── Pembayaran ── */
                KIPAY_API_KEY: process.env.KIPAY_API_KEY || '',

                // PAIRING_NUMBER: '628xxxxxxxxxx',
            }
        }
    ]
};
