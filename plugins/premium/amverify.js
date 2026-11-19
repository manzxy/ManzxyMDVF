/**
 * Plugin: Alight Motion Verification
 * Diadaptasi persis dari script asli (menggunakan Axios & File Logging)
 * Output telah dipercantik khusus untuk WhatsApp.
 */

const axios = require('axios');
const fs = require('fs/promises');

const CONFIG = {
    baseURL: "https://am.noxxyrorr.biz.id",
    logFile: "./verification-log.txt",
    timeout: 30000,
    userAgent: "Mozilla/5.0 (Linux; Android 9; CPH2071) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
};

// Konfigurasi instance Axios bawaan script
const api = axios.create({
    baseURL: CONFIG.baseURL,
    timeout: CONFIG.timeout,
    validateStatus: () => true, // Agar axios tidak throw error pada status != 200
    headers: {
        "Content-Type": "application/json",
        "User-Agent": CONFIG.userAgent,
        "Referer": `${CONFIG.baseURL}/`
    }
});

// Penyimpanan sesi verifikasi sementara (untuk alur chat WhatsApp)
const sessions = new Map();

/* ───────────────────────── HELPER FUNCTIONS ───────────────────────── */

const mask = (value, start = 8, end = 5) => {
    if (typeof value !== "string" || !value) {
        return "Tidak tersedia";
    }
    if (value.length <= start + end) {
        return "*".repeat(value.length);
    }
    return `${value.slice(0, start)}${"*".repeat(12)}${value.slice(-end)}`;
};

const maskEmail = (email) => {
    const [name, domain] = email.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
};

const validateEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const validateMagicLink = (value) => {
    try {
        const url = new URL(value);
        return (
            url.protocol === "https:" &&
            url.hostname === "alight-creative.firebaseapp.com" &&
            url.pathname.startsWith("/__/auth/links")
        );
    } catch {
        return false;
    }
};

const saveLog = async (entry) => {
    try {
        await fs.appendFile(
            CONFIG.logFile,
            `${JSON.stringify(entry, null, 2)}\n\n`,
            { encoding: "utf8", mode: 0o600 }
        );
        await fs.chmod(CONFIG.logFile, 0o600).catch(() => {});
    } catch (err) {
        console.error("[!] Gagal menyimpan log:", err.message);
    }
};

const getErrorMessage = (data, fallback) =>
    data?.message || data?.error?.message || data?.error || fallback;

/* ───────────────────────── PLUGIN EXECUTION ───────────────────────── */

module.exports = {
    name: 'AM Verification',
    command: ['amverify', 'amlogin'],
    category: 'premium',
    premium: true,
    description: 'Verifikasi login Alight Motion via Magic Link',
    usage: '.amverify <email>',
    
    async execute(sock, m, { args, sender, reply, prefix, command }) {
        if (!args[0]) {
            return reply(`*Panduan AM VERIFICATION*\nKetik \`${prefix}${command} <email>\`\n\nContoh:\n\`${prefix}${command} user@gmail.com\``);
        }

        const email = args[0].trim();

        if (!validateEmail(email)) {
            return reply('❌ Format email tidak valid.');
        }

        if (sessions.has(sender)) {
            return reply('⚠️ Kamu masih dalam proses verifikasi. Kirim *Magic Link*, atau ketik *cancel* untuk membatalkan.');
        }

        await reply(`⏳ [1/2] Mengirim magic link ke *${email}*...`);

        try {
            const sendResponse = await api.post("/api/send-link", { email });

            if (sendResponse.status < 200 || sendResponse.status >= 300 || !sendResponse.data?.success) {
                throw new Error(getErrorMessage(sendResponse.data, `send-link gagal (HTTP ${sendResponse.status}).`));
            }

            const cookie = sendResponse.data.cookie;

            if (typeof cookie !== "string" || !cookie.trim()) {
                throw new Error("send-link berhasil, tetapi cookie tidak ditemukan.");
            }

            // Set timer 5 menit agar sesi tidak nyangkut
            const timer = setTimeout(() => {
                if (sessions.has(sender)) {
                    sessions.delete(sender);
                    sock.sendMessage(m.key.remoteJid, { text: `⏳ Sesi verifikasi AM untuk ${maskEmail(email)} telah habis.` });
                }
            }, 5 * 60 * 1000);

            sessions.set(sender, { email, cookie, timer, sendResponse });

            let msg = `✨ *MAGIC LINK TERKIRIM* ✨\n\n`;
            msg += `📧 *Email:* ${maskEmail(email)}\n`;
            msg += `🍪 *Cookie:* \`${mask(cookie)}\`\n\n`;
            msg += `📌 *Langkah selanjutnya:*\n`;
            msg += `Buka kotak masuk Gmail, salin tautan verifikasi yang masuk, lalu *tempel (paste)* tautannya di chat ini.\n\n`;
            msg += `_(Ketik *cancel* untuk membatalkan)_`;
            
            return reply(msg);

        } catch (error) {
            const response = error.response;
            const failure = {
                timestamp: new Date().toISOString(),
                email: email || null,
                success: false,
                error: error.message,
                httpStatus: response?.status ?? null,
                response: response?.data ?? null,
                session: null,
                magicLink: null
            };
            await saveLog(failure);
            return reply(`❌ *[ERROR]*\n${error.message}`);
        }
    },

    // Hook before untuk memproses link yang dikirim
    async before(m, { sock, from, sender, body }) {
        if (!sessions.has(sender)) return false;

        const session = sessions.get(sender);
        
        // Fungsi reply lokal
        const reply = async (text) => {
            if (typeof sock.reply === 'function') {
                return await sock.reply(from, text, m);
            }
            return await sock.sendMessage(from, { text }, { quoted: m });
        };

        if (body.toLowerCase() === 'cancel') {
            clearTimeout(session.timer);
            sessions.delete(sender);
            await reply('✅ Sesi verifikasi AM dibatalkan.');
            return true; 
        }

        // Cek apakah pesan berisi magic link
        if (body.includes("alight-creative.firebaseapp.com/__/auth/links")) {
            const magicLinkMatch = body.match(/https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\S+/);
            const magicLink = magicLinkMatch ? magicLinkMatch[0] : body.trim();

            if (!validateMagicLink(magicLink)) {
                await reply('❌ Magic link tidak valid atau domain/path tidak sesuai. Silakan tempel link yang benar.');
                return true; 
            }

            clearTimeout(session.timer);
            sessions.delete(sender);
            
            await reply('⏳ [2/2] Menjalankan verify-link...');

            try {
                const verifyResponse = await api.post("/api/verify-link", {
                    email: session.email,
                    magicLink,
                    cookie: session.cookie
                });

                const result = verifyResponse.data ?? {};
                const authenticated = result.authenticated ?? result.data?.authenticated ?? null;
                const premiumActive = result.premiumActive ?? result.data?.premiumActive ?? null;
                const success = verifyResponse.status >= 200 && verifyResponse.status < 300 && result.success === true;

                const logEntry = {
                    timestamp: new Date().toISOString(),
                    email: session.email,
                    sendLink: {
                        status: session.sendResponse.status,
                        success: session.sendResponse.data?.success === true,
                        message: session.sendResponse.data?.message ?? null
                    },
                    session: {
                        cookie: session.cookie
                    },
                    magicLink,
                    verification: {
                        httpStatus: verifyResponse.status,
                        success,
                        authenticated,
                        premiumActive,
                        message: result.message ?? null,
                        response: result
                    }
                };

                await saveLog(logEntry);

                const data = result.data ?? {};
                const raw = result.raw ?? {};
                const idToken = data.idToken ?? raw.idToken ?? raw.user?.stsTokenManager?.accessToken;
                const refreshToken = data.refreshToken ?? raw.refreshToken ?? raw.user?.stsTokenManager?.refreshToken;

                // Tampilan Output WhatsApp yang lebih cantik
                const statusIcon = success ? '✅' : '❌';
                const isAuth = authenticated ? '✅ Ya' : '❌ Tidak';
                const isPrem = premiumActive ? '✅ Aktif' : '❌ Tidak Aktif';

                let output = `✨ *AM VERIFICATION RESULT* ✨\n`;
                output += `──────────────────────\n\n`;
                output += `📧 *Email:* ${maskEmail(session.email)}\n`;
                output += `${statusIcon} *Status:* ${success ? 'Berhasil' : 'Gagal'} (HTTP ${verifyResponse.status})\n`;
                output += `🔐 *Auth:* ${isAuth}\n`;
                output += `👑 *Premium:* ${isPrem}\n\n`;
                
                output += `*🔑 TOKENS & SESSION*\n`;
                output += `🔹 *ID Token:*\n\`${mask(idToken)}\`\n\n`;
                output += `🔹 *Refresh Token:*\n\`${mask(refreshToken)}\`\n\n`;
                output += `🔹 *Cookie:*\n\`${mask(session.cookie)}\`\n\n`;

                if (result.message) {
                    output += `📝 *Catatan:* _${result.message}_\n`;
                }
                output += `──────────────────────`;

                await reply(output);

                if (!success) {
                    await reply("⚠️ *Peringatan:* Server belum menyatakan verifikasi berhasil. Periksa response di file log untuk detailnya.");
                }

            } catch (error) {
                const response = error.response;
                const failure = {
                    timestamp: new Date().toISOString(),
                    email: session.email,
                    success: false,
                    error: error.message,
                    httpStatus: response?.status ?? null,
                    response: response?.data ?? null,
                    session: { cookie: session.cookie },
                    magicLink: magicLink
                };
                
                await saveLog(failure);
                await reply(`❌ *[ERROR VERIFIKASI]*\n\n\`\`\`${error.message}\`\`\`\n\nCek log untuk detail lebih lanjut.`);
            }

            return true;
        }

        return false;
    }
};
