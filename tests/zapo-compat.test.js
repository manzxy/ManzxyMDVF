'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    translateEvent,
    translateContent,
    toJid,
} = require('../lib/wa/zapoCompat');

test('toJid: angka dan jid', () => {
    assert.equal(toJid('6281234567890'), '6281234567890@s.whatsapp.net');
    assert.equal(toJid('6281234567890@g.us'), '6281234567890@g.us');
    assert.throws(() => toJid(''));
});

test('translateEvent: message -> messages.upsert', () => {
    const ev = {
        event: {
            key: { remoteJid: '6281@g.us', id: 'MSG1', fromMe: false },
            message: { conversation: 'halo' },
            timestampSeconds: 1700000000,
            pushName: 'Udin',
        },
    };
    const out = translateEvent('message', ev);
    assert.equal(out.length, 1);
    assert.equal(out[0][0], 'messages.upsert');
    assert.equal(out[0][1].type, 'notify');
    assert.equal(out[0][1].messages[0].key.id, 'MSG1');
    assert.equal(out[0][1].messages[0].message.conversation, 'halo');
    assert.equal(out[0][1].messages[0].messageTimestamp.toNumber(), 1700000000);
});

test('translateEvent: connection open/close', () => {
    assert.deepEqual(translateEvent('connection', { status: 'open' })[0][1], { connection: 'open' });
    const close = translateEvent('connection', { status: 'close', code: 401, reason: 'logged_out' })[0][1];
    assert.equal(close.connection, 'close');
    assert.equal(close.lastDisconnect.error.output.statusCode, 401);
});

test('translateEvent: qr', () => {
    const out = translateEvent('auth_qr', { qr: 'DATA:QR' });
    assert.equal(out[0][1].qr, 'DATA:QR');
});

test('translateEvent: group participants vs metadata', () => {
    const parts = translateEvent('group', { event: { id: '6281@g.us', action: 'add', participants: ['6282@s.whatsapp.net'] } });
    assert.equal(parts[0][0], 'group-participants.update');
    assert.deepEqual(parts[0][1].participants, ['6282@s.whatsapp.net']);

    const meta = translateEvent('group', { event: { id: '6281@g.us', subject: 'Grup A' } });
    assert.equal(meta[0][0], 'groups.update');
    assert.equal(meta[0][1][0].subject, 'Grup A');
});

test('translateEvent: call', () => {
    const out = translateEvent('call', { event: [{ id: 'C1', from: '6282@s.whatsapp.net', isVideo: false }] });
    assert.equal(out[0][0], 'call');
    assert.equal(out[0][1][0].from, '6282@s.whatsapp.net');
});

test('translateContent: text with quoted', () => {
    const r = translateContent('halo', { quoted: { key: { id: 'Q1' } } });
    assert.equal(r.content, 'halo');
    assert.equal(r.options.quote.key.id, 'Q1');
});

test('translateContent: react/delete/edit/poll', () => {
    assert.equal(translateContent({ react: { text: '🔥', key: { id: 'M1' } } }).content.type, 'reaction');
    assert.equal(translateContent({ delete: { id: 'M1' } }).content.type, 'revoke');
    assert.equal(translateContent({ edit: { id: 'M1' }, text: 'baru' }).options.editKey.id, 'M1');
    const poll = translateContent({ poll: { name: 'P', values: ['A', 'B'], selectableCount: 1 } }).content;
    assert.equal(poll.type, 'poll');
    assert.deepEqual(poll.options, ['A', 'B']);
});

test('translateContent: media', () => {
    const img = translateContent({ image: { url: 'http://x/a.jpg' }, caption: 'cap', mimetype: 'image/jpeg' }).content;
    assert.equal(img.type, 'image');
    assert.equal(img.caption, 'cap');
    const voice = translateContent({ audio: { url: 'http://x/a.ogg' }, ptt: true, mimetype: 'audio/ogg' }).content;
    assert.equal(voice.type, 'ptv');
});

test('translateContent: raw proto passed through', () => {
    const raw = { richResponseMessage: { messageType: 1, submessages: [] } };
    assert.deepEqual(translateContent(raw).content, raw);
});
