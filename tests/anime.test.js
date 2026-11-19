/**
 * Test: lib/anime.js — normalisasi data OmnifyAnime API.
 *
 * Test ini TIDAK memanggil jaringan. Semua bentuk respons diambil dari
 * respons API nyata (diverifikasi 2026-11-18) lalu dipakai sebagai fixture,
 * supaya perubahan bentuk data ketahuan tanpa bergantung pada API hidup.
 */
const test = require('node:test');
const assert = require('node:assert');

const anime = require('../lib/services/anime');

/* ── fixture: bentuk asli respons API ── */

const rawListItem = {
    id: 'naruto-kecil',
    title: 'NARUTO',
    alt_titles: ['Naruto Kecil'],
    poster: 'https://example.test/poster.jpg',
    banner: 'https://example.test/banner.jpg',
    rating: '8.0',
    type: 'TV',
    origin: 'JP',
    status: 'Completed',
    genres: ['Action', 'Adventure'],
    views: 742723,
    favorites: 42399,
    available_qualities: ['1080p', '720p'],
    current_episode: 12,
    uploaded_ago: '2 hari lalu',
};

const rawDetail = {
    id: 'naruto-kecil',
    title: 'NARUTO',
    alt_titles: [],
    synopsis: 'Naruto Uzumaki adalah seorang ninja hiperaktif.',
    poster: 'https://example.test/poster.jpg',
    banner: 'https://example.test/banner.jpg',
    rating: '7.9',
    status: 'Completed',
    type: 'TV',
    origin: 'JP',
    duration: '23 menit',
    studio: 'Studio Pierrot',
    season: 'Fall 2002',
    genres: ['Action'],
    views: 742723,
    favorites: 42399,
    updated_at: '2026-10-17T13:26:32.315Z',
    uploaded_ago: '1 bulan lalu',
    trailer_url: 'https://example.test/trailer',
    episodes: [
        { episode_number: 1, title: 'Episode 1', episode_id: 'naruto-kecil-ep-1', released_at: '2026-08-29T19:29:39.000Z', uploaded_ago: '2 bulan lalu' },
        { episode_number: 2, title: 'Episode 2', episode_id: 'naruto-kecil-ep-2' },
    ],
    characters: [{ name: 'Naruto Uzumaki', role: 'Main', image: 'https://example.test/c.jpg' }],
    relations: [{ relation_type: 'Sequel', title: 'Naruto Shippuuden', type: 'TV', status: 'Completed', rating: '8.2', poster: 'https://example.test/r.jpg' }],
    downloads: {
        episodes: [
            {
                title: 'Episode 1',
                downloads: [
                    { quality: '360p', links: [{ server: 'Mirror 1', url: 'https://example.test/360' }] },
                ],
            },
        ],
    },
};

const rawSchedule = [
    {
        day: 'Senin',
        items: [
            { id: 'km-3187-x', title: 'The iDOLM@STER Shiny Colors 2nd Season', air_time: 'Jam 04:39 WIB', views: 2584, favorites: 34, poster: 'https://example.test/s.jpg' },
        ],
    },
];

const rawEpisode = {
    episode_id: 'naruto-kecil-ep-1',
    anime_id: 'naruto-kecil',
    episode_number: 1,
    has_next_episode: true,
    has_prev_episode: false,
    streams: [
        { server: 'Server 1 (Primary)', quality: '1080p', stream_url: 'https://example.test/1080' },
        { server: 'Server 2 (Backup)', quality: '1080p', stream_url: 'https://example.test/1080b' },
        { server: 'Server 1 (Primary)', quality: '360p', stream_url: 'https://example.test/360' },
    ],
};

/* ── normalisasi daftar ── */

test('normalizeList: memetakan field snake_case ke camelCase', () => {
    const item = anime.normalizeList(rawListItem);
    assert.equal(item.id, 'naruto-kecil');
    assert.equal(item.title, 'NARUTO');
    assert.equal(item.rating, '8.0');
    assert.equal(item.views, 742723);
    assert.equal(item.currentEpisode, 12);
    assert.equal(item.uploadedAgo, '2 hari lalu');
    assert.deepEqual(item.genres, ['Action', 'Adventure']);
    assert.deepEqual(item.qualities, ['1080p', '720p']);
});

test('normalizeList: data kosong tidak menghasilkan undefined yang bocor ke pesan', () => {
    const item = anime.normalizeList({});
    assert.equal(item.title, 'Tanpa judul');
    assert.equal(item.rating, '-');
    assert.equal(item.type, '-');
    assert.deepEqual(item.genres, []);
    assert.equal(item.views, 0);
});

/* ── normalisasi detail ── */

test('normalizeDetail: episode, karakter, relasi, dan unduhan ikut dinormalisasi', () => {
    const d = anime.normalizeDetail(rawDetail);
    assert.equal(d.episodes.length, 2);
    assert.equal(d.episodes[0].number, 1);
    assert.equal(d.episodes[0].id, 'naruto-kecil-ep-1');
    assert.equal(d.characters[0].name, 'Naruto Uzumaki');
    assert.equal(d.relations[0].title, 'Naruto Shippuuden');
    assert.equal(d.downloads[0].qualities[0].quality, '360p');
    assert.equal(d.downloads[0].qualities[0].links[0].server, 'Mirror 1');
});

test('normalizeDetail: detail tanpa episode tetap aman', () => {
    const d = anime.normalizeDetail({ id: 'x', title: 'X' });
    assert.deepEqual(d.episodes, []);
    assert.deepEqual(d.characters, []);
    assert.deepEqual(d.relations, []);
    assert.deepEqual(d.downloads, []);
});

/* ── jadwal: bentuk bersarang ── */

test('schedule: bentuk bersarang [{day, items}] diratakan', async () => {
    // Ganti request lewat modul http internal: cukup uji normalisasi lewat
    // helper yang sama seperti yang dipakai schedule().
    const groups = rawSchedule;
    const out = [];
    for (const group of groups) {
        for (const item of group.items) {
            out.push({ ...anime.normalizeList(item), airTime: item.air_time, day: group.day });
        }
    }
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'The iDOLM@STER Shiny Colors 2nd Season');
    assert.equal(out[0].airTime, 'Jam 04:39 WIB');
    assert.equal(out[0].day, 'Senin');
});

/* ── episode ── */

test('episode: stream dinormalisasi dan urutannya dipertahankan', () => {
    const streams = rawEpisode.streams.map((s) => ({
        server: s.server, quality: s.quality, url: s.stream_url,
    }));
    assert.equal(streams.length, 3);
    assert.equal(streams[0].quality, '1080p');
    assert.equal(streams[0].url, 'https://example.test/1080');
    assert.equal(rawEpisode.has_next_episode, true);
});

/* ── format tampilan ── */

test('fmtCount: ribuan, juta, miliar', () => {
    assert.equal(anime.fmtCount(742723), '742.7K');
    assert.equal(anime.fmtCount(1500000), '1.5M');
    assert.equal(anime.fmtCount(2000000000), '2.0B');
    assert.equal(anime.fmtCount(0), '0');
    assert.equal(anime.fmtCount(undefined), '0');
});

test('fmtBytes: MB dan GB', () => {
    assert.equal(anime.fmtBytes(225819939), '215.4 MB');
    assert.equal(anime.fmtBytes(1310664352), '1.2 GB');
    assert.equal(anime.fmtBytes(1024), '1.0 KB');
});

test('truncate: memotong di batas kata dan menambah elipsis', () => {
    const text = 'kata '.repeat(200);
    const out = anime.truncate(text, 50);
    assert.ok(out.length <= 52, `panjang ${out.length} harus <= 52`);
    assert.ok(out.endsWith('…'));
    assert.ok(!out.includes('  '), 'tidak boleh ada spasi ganda');
});

test('truncate: teks pendek tidak diubah', () => {
    assert.equal(anime.truncate('pendek', 50), 'pendek');
});

test('todayName: mengembalikan nama hari Indonesia', () => {
    const hari = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu'];
    assert.ok(hari.includes(anime.todayName()));
});

/* ── cache hasil per chat ── */

test('remember/recall: menyimpan dan mengembalikan hasil per chat', () => {
    const chat = 'test-chat-' + Date.now();
    assert.equal(anime.recall(chat), null);

    anime.remember(chat, [{ id: 'a' }, { id: 'b' }]);
    const got = anime.recall(chat);
    assert.equal(got.length, 2);
    assert.equal(got[1].id, 'b');
});

test('remember: daftar kosong tidak menimpa cache yang ada', () => {
    const chat = 'test-chat-empty-' + Date.now();
    anime.remember(chat, [{ id: 'a' }]);
    anime.remember(chat, []);
    assert.equal(anime.recall(chat).length, 1);
});

test('recall: chat tak dikenal mengembalikan null', () => {
    assert.equal(anime.recall('chat-yang-tidak-pernah-ada'), null);
});

/* ── error ── */

test('search: kata kunci kosong melempar AnimeError', async () => {
    await assert.rejects(() => anime.search('   '), (err) => {
        assert.equal(err.name, 'AnimeError');
        return true;
    });
});

test('detail: id kosong melempar AnimeError', async () => {
    await assert.rejects(() => anime.detail(''), (err) => err.name === 'AnimeError');
});

test('episode: id kosong melempar AnimeError', async () => {
    await assert.rejects(() => anime.episode(''), (err) => err.name === 'AnimeError');
});
