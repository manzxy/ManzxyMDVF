/**
 * Penyimpan pesan kecil (in-memory, dibatasi) — dipakai untuk polling.
 * Baileys butuh pesan pembuat polling (getMessage) agar suara (vote) bisa didekripsi,
 * jadi setiap polling yang masuk / dikirim bot dicatat di sini.
 */
const MAX = 300;
const store = new Map();     // id pesan -> WebMessageInfo
const botPolls = new Set();  // id polling yang dibuat bot sendiri

function remember(m) {
    const id = m?.key?.id;
    if (!id || !m.message) return;
    store.delete(id);
    store.set(id, m);
    while (store.size > MAX) store.delete(store.keys().next().value);
}

const get = (id) => store.get(id) || null;

/** Untuk opsi `getMessage` pada makeWASocket. */
const getMessage = async (key) => store.get(key?.id)?.message || undefined;

/** Tandai polling buatan bot (hanya polling ini yang suaranya boleh dijalankan sebagai perintah). */
function markBotPoll(id) {
    if (!id) return;
    botPolls.add(id);
    while (botPolls.size > MAX) botPolls.delete(botPolls.values().next().value);
}
const isBotPoll = (id) => botPolls.has(id);

module.exports = { remember, get, getMessage, markBotPoll, isBotPoll };
