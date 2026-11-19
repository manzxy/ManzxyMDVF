/**
 * lib/web/passkey.js — login WebAuthn (passkey) tanpa dependency eksternal.
 * Mendukung algoritma ES256 (P-256) pada authenticator platform (fingerprint/FaceID/Windows Hello).
 * Verifikasi: CBOR mini-decoder untuk attestationObject, JWK → crypto.verify dsaEncoding ieee-p1363.
 */
const crypto = require('crypto');
const store = require('./store');
const { logWarn } = require('../core/logger');

const CHALLENGE_TTL = 5 * 60 * 1000;
const pending = new Map();                       // key: `reg:${accountId}` | `login:${email}` → { challenge, expires }

/* ───────────────────────── util base64url ───────────────────────── */

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');

/* ───────────────────────── CBOR mini-decoder ───────────────────────── */

function cbor(buf, off = 0) {
    const ib = buf[off];
    if (ib === undefined) throw new Error('CBOR: buffer habis');
    const major = ib >> 5;
    const info = ib & 0x1f;
    const readLen = () => {
        if (info < 24) return info;
        if (info === 24) return buf[off + 1];
        if (info === 25) return buf.readUInt16BE(off + 1);
        if (info === 26) return buf.readUInt32BE(off + 1);
        throw new Error('CBOR: panjang tidak didukung (64-bit)');
    };
    if (major === 0) {                                   // unsigned int
        if (info < 24) return [ib, off + 1];
        if (info === 24) return [buf[off + 1], off + 2];
        if (info === 25) return [buf.readUInt16BE(off + 1), off + 3];
        if (info === 26) return [buf.readUInt32BE(off + 1), off + 5];
        throw new Error('CBOR: int terlalu besar');
    }
    if (major === 1) {                                   // negative int
        if (info < 24) return [-1 - info, off + 1];
        if (info === 24) return [-1 - buf[off + 1], off + 2];
        if (info === 25) return [-1 - buf.readUInt16BE(off + 1), off + 3];
        if (info === 26) return [-1 - buf.readUInt32BE(off + 1), off + 5];
        throw new Error('CBOR: int negatif terlalu besar');
    }
    if (major === 2 || major === 3) {                    // byte / text string
        const len = readLen();
        const hdr = info < 24 ? 1 : info === 24 ? 2 : info === 25 ? 3 : 5;
        const body = buf.subarray(off + hdr, off + hdr + len);
        return [major === 2 ? body : body.toString('utf8'), off + hdr + len];
    }
    if (major === 4) {                                   // array
        const len = readLen();
        const hdr = info < 24 ? 1 : info === 24 ? 2 : info === 25 ? 3 : 5;
        let o = off + hdr;
        const arr = [];
        for (let i = 0; i < len; i++) { const [v, no] = cbor(buf, o); arr.push(v); o = no; }
        return [arr, o];
    }
    if (major === 5) {                                   // map
        const len = readLen();
        const hdr = info < 24 ? 1 : info === 24 ? 2 : info === 25 ? 3 : 5;
        let o = off + hdr;
        const map = {};
        for (let i = 0; i < len; i++) {
            const [k, o1] = cbor(buf, o);
            const [v, o2] = cbor(buf, o1);
            map[String(k)] = v;
            o = o2;
        }
        return [map, o];
    }
    if (ib === 0xf6 || ib === 0xf7) return [null, off + 1];   // null/undefined
    throw new Error(`CBOR: tipe ${ib} tidak didukung`);
}

/* ───────────────────────── parsing WebAuthn ───────────────────────── */

function parseClientData(b64) {
    const json = JSON.parse(unb64u(b64).toString('utf8'));
    if (!json.challenge || !json.origin) throw new Error('clientData tidak valid.');
    return json;
}

/** authData → { rpIdHash, flags, counter, credId?, coseKey? } */
function parseAuthData(buf) {
    if (buf.length < 37) throw new Error('authData terlalu pendek.');
    const rpIdHash = buf.subarray(0, 32);
    const flags = buf[32];
    const counter = buf.readUInt32BE(33);
    const out = { rpIdHash, flags, counter };
    if (flags & 0x40) {                                  // AT: attested credential data
        let o = 37;
        o += 16;                                         // aaguid
        const idLen = buf.readUInt16BE(o); o += 2;
        out.credId = buf.subarray(o, o + idLen); o += idLen;
        const [cose] = cbor(buf, o);
        out.coseKey = cose;
    }
    return out;
}

/** COSE key ES256/P-256 → JWK untuk crypto */
function coseToJwk(cose) {
    if (cose['1'] !== 2 || cose['3'] !== -7 || cose['-1'] !== 1) throw new Error('Algoritma passkey tidak didukung (butuh ES256/P-256).');
    const x = Buffer.from(cose['-2']);
    const y = Buffer.from(cose['-3']);
    if (x.length !== 32 || y.length !== 32) throw new Error('Koordinat kunci tidak valid.');
    return { kty: 'EC', crv: 'P-256', x: b64u(x), y: b64u(y) };
}

function verifySignature(jwk, signedData, rawSig) {
    let pub;
    try { pub = crypto.createPublicKey({ key: { ...jwk, kty: 'EC', crv: 'P-256' }, format: 'jwk' }); }
    catch { throw new Error('Kunci publik tidak valid.'); }
    return crypto.verify('sha256', signedData, { key: pub, dsaEncoding: 'ieee-p1363' }, rawSig);
}

/* ───────────────────────── passkeys akun ───────────────────────── */

function listPasskeys(accountId) {
    try { return JSON.parse(store.getSetting(accountId, 'passkeys', '[]') || '[]'); } catch { return []; }
}

function savePasskeys(accountId, list) {
    store.setSetting(accountId, 'passkeys', JSON.stringify(list.slice(0, 5)));
}

function setPending(key, challenge) {
    pending.set(key, { challenge, expires: Date.now() + CHALLENGE_TTL });
    for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
}

function takePending(key, challengeB64) {
    const p = pending.get(key);
    if (!p || p.expires < Date.now()) { pending.delete(key); throw new Error('Sesi passkey kadaluarsa — coba lagi.'); }
    pending.delete(key);
    if (p.challenge !== String(challengeB64 || '')) throw new Error('Challenge tidak cocok.');
    return p;
}

/* ───────────────────────── registrasi ───────────────────────── */

function startRegister(account, { rpId, rpName }) {
    const challenge = b64u(crypto.randomBytes(32));
    setPending(`reg:${account.id}`, challenge);
    return {
        challenge,
        rp: { id: rpId || undefined, name: rpName || 'ManzxyMD' },
        user: { id: b64u(`uid-${account.id}`), name: account.email, displayName: account.display_name || account.email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        timeout: 120000,
        attestation: 'none'
    };
}

/** body = { id, rawId, response: { clientDataJSON, attestationObject }, type } */
function finishRegister(account, body, { rpId, origin }) {
    const cd = parseClientData(body.response?.clientDataJSON);
    if (cd.type !== 'webauthn.create') throw new Error('Bukan respons pendaftaran passkey.');
    takePending(`reg:${account.id}`, cd.challenge);
    if (origin && cd.origin && !cd.origin.startsWith(origin.split('://')[0] + '://') ) { /* origin dicek longgar: host harus sama */ }
    if (origin && cd.origin && new URL(cd.origin).host !== new URL(origin).host) throw new Error('Origin tidak cocok dengan panel.');

    const att = cbor(unb64u(body.response.attestationObject))[0];
    const authData = parseAuthData(Buffer.from(att.authData));
    if (!(authData.flags & 0x40) || !authData.credId) throw new Error('Tidak ada credential pada respons.');
    if (rpId && !authData.rpIdHash.equals(crypto.createHash('sha256').update(rpId).digest())) throw new Error('RP ID tidak cocok.');

    const jwk = coseToJwk(authData.coseKey);
    const list = listPasskeys(account.id);
    const id = b64u(authData.credId);
    if (list.some((p) => p.id === id)) throw new Error('Passkey ini sudah terdaftar.');
    list.push({ id, jwk, counter: authData.counter, name: `Passkey ${list.length + 1}`, createdAt: Date.now() });
    savePasskeys(account.id, list);
    store.log(account.id, 'passkey_add', id.slice(0, 12) + '…');
    return { ok: true, id, total: list.length };
}

/* ───────────────────────── login ───────────────────────── */

function startLogin(email, { rpId }) {
    const acc = store.getAccountByEmail(String(email || ''));
    const list = acc ? listPasskeys(acc.id) : [];
    if (!acc || !list.length) throw new Error('Tidak ada passkey untuk email ini.');
    const challenge = b64u(crypto.randomBytes(32));
    setPending(`login:${String(email).toLowerCase().trim()}`, challenge);
    return {
        challenge,
        rpId: rpId || undefined,
        allowCredentials: list.map((p) => ({ type: 'public-key', id: p.id })),
        userVerification: 'preferred',
        timeout: 120000
    };
}

/** body = { email, id, response: { clientDataJSON, authenticatorData, signature } } → { account, token } */
function finishLogin(body, { ip = '', ua = '' } = {}) {
    const emailKey = String(body.email || '').toLowerCase().trim();
    const acc = store.getAccountByEmail(emailKey);
    if (!acc) throw new Error('Tidak ada passkey untuk email ini.');
    const cd = parseClientData(body.response?.clientDataJSON);
    if (cd.type !== 'webauthn.get') throw new Error('Bukan respons login passkey.');
    takePending(`login:${emailKey}`, cd.challenge);

    const credId = String(body.id || '');
    const list = listPasskeys(acc.id);
    const pk = list.find((p) => p.id === credId);
    if (!pk) throw new Error('Passkey tidak dikenali.');

    const authData = Buffer.from(unb64u(body.response.authenticatorData));
    const parsed = parseAuthData(authData);
    const clientHash = crypto.createHash('sha256').update(unb64u(body.response.clientDataJSON)).digest();
    const ok = verifySignature(pk.jwk, Buffer.concat([authData, clientHash]), unb64u(body.response.signature));
    if (!ok) {
        store.log(acc.id, 'passkey_login_failed', 'signature salah', ip);
        throw new Error('Verifikasi passkey gagal.');
    }
    // anti-replay: counter harus naik bila authenticator menyimpan counter
    if (parsed.counter !== 0 && parsed.counter <= (pk.counter || 0)) {
        logWarn('PASSKEY', `counter tidak naik untuk ${emailKey} (mungkin credential dikloning)`);
        throw new Error('Verifikasi passkey gagal (counter).');
    }
    pk.counter = parsed.counter;
    savePasskeys(acc.id, list);

    const token = require('./auth').issueSession(acc, { ip, ua });
    store.log(acc.id, 'login', 'passkey', ip);
    return { account: acc, token };
}

function removePasskey(accountId, id) {
    const list = listPasskeys(accountId);
    const next = list.filter((p) => p.id !== String(id || ''));
    if (next.length === list.length) throw new Error('Passkey tidak ditemukan.');
    savePasskeys(accountId, next);
    store.log(accountId, 'passkey_remove', String(id || '').slice(0, 12) + '…');
    return { ok: true, total: next.length };
}

module.exports = { startRegister, finishRegister, startLogin, finishLogin, removePasskey, listPasskeys };
