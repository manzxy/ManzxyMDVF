/**
 * RPG ENGINE — lapisan kompatibilitas.
 * Kode lama memakai require('../../lib/data/rpg') dan mengharapkan `quest*`.
 * Sekarang quest berbasis kampanye (story.js). Berkas ini meneruskan
 * seluruh API baru dan menyediakan shim quest agar plugin lama tetap jalan.
 */

const engine = require('./rpg/index');

/* ── Shim quest lama → kampanye baru ── */

/** Quest = babak yang sedang aktif. */
const QUESTS = engine.CHAPTERS.map((c) => ({
    id: `ch${c.id}`,
    title: c.title,
    target: c.objective?.target || c.objective?.list?.[0]?.target || '',
    need: c.objective?.count || c.objective?.list?.reduce((a, b) => a + b.count, 0) || 1,
    reward: c.reward
}));

/** Babak berikutnya yang belum selesai. */
function nextQuest(p) {
    const ch = engine.activeChapter(p);
    if (!ch) return null;
    return QUESTS[ch.id] || null;
}

/** Progres babak aktif dalam bentuk quest. */
function questProgress(p) {
    const pr = engine.chapterProgress(p);
    if (!pr) return null;
    if (pr.parts) {
        const have = pr.parts.reduce((a, b) => a + b.have, 0);
        const need = pr.parts.reduce((a, b) => a + b.need, 0);
        return { quest: QUESTS[pr.chapter.id], have, need, done: pr.done };
    }
    return { quest: QUESTS[pr.chapter.id], have: pr.have || 0, need: pr.need || 0, done: pr.done };
}

/** Klaim = selesaikan babak. */
function claimQuest(p) {
    const r = engine.completeChapter(p);
    if (r.error) return r;
    const q = QUESTS[r.chapter.id];
    return { ok: true, quest: q, reward: r.chapter.reward, levelUp: r.levelUp, levels: r.levels, nextChapter: r.next };
}

module.exports = { ...engine, QUESTS, nextQuest, questProgress, claimQuest };
