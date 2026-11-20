const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const config = require('../config');
require('../lib/core/configDefaults').apply(config);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manzxy-promotions-'));
config.database.path = path.join(tempDir, 'db.json');
config.database.saveDelayMs = 60000;
const db = require('../lib/data/database');
db.load();
const promotions = require('../lib/billing/promotions');
const payment = require('../lib/billing/payment');
const renewal = require('../lib/billing/renewal');
const axios = require('axios');

test('promo jadibot dibatasi slot, diskon tiap produk tersimpan terpisah', () => {
    assert.equal(promotions.freeJadibot(), false);
    promotions.setFreeSlots(1);
    promotions.setFreeJadibot(true);
    assert.equal(promotions.freeJadibot(), true);
    assert.equal(promotions.freeAvailable('628123456789'), true);
    db.getJadibot('628123456789').tier = 'free';
    assert.equal(promotions.freeUsage(), 1);
    assert.equal(promotions.freeAvailable('628123456789'), true);
    assert.equal(promotions.freeAvailable('628987654321'), false);
    promotions.setFreeSlots(0);
    assert.equal(promotions.freeJadibot(), false);
    assert.equal(renewal.isFree('jadibot'), false);
    db.removeJadibot('628123456789');
    promotions.setFreeJadibot(false);
    assert.throws(() => promotions.setFreeSlots(-1));
    promotions.setDiscount('prem', 20);
    assert.equal(promotions.quote('prem', 5000).price, 4000);
    assert.equal(promotions.discount('jadibot'), 0);
    assert.equal(db.data.settings.promotions.discounts.prem, 20);
    assert.equal(promotions.quote('prem', 5000).basePrice, 5000);
    assert.throws(() => promotions.setDiscount('prem', 100));
    assert.throws(() => promotions.setDiscount('prem', -1));
    assert.equal(promotions.quote('prem', 1).price, 1);
});

test('tagihan baru menggunakan harga diskon dan menyimpan snapshot promo', async () => {
    const originalPost = axios.post;
    const sent = [];
    axios.post = async (_url, data) => {
        sent.push(data.amount);
        return { data: { trx_id: `test-${sent.length}`, amount: data.amount + 17, expires_at: new Date(Date.now() + 60000).toISOString(), qr_payload: 'payload' } };
    };
    try {
        promotions.setDiscount('jadibot', 25);
        const first = await payment.createJadibotOrder({ target: '628123456789', owner: '628222222222', chat: 'test', durationMs: 7 * 86400000 });
        assert.equal(first.order.basePrice, 5000);
        assert.equal(first.order.discountPercent, 25);
        assert.equal(first.order.price, 3750);
        assert.equal(first.order.amount, 3767);
        promotions.setDiscount('jadibot', 0);
        assert.equal(first.order.price, 3750);
        promotions.setDiscount('prem', 10);
        const second = await payment.createRenewOrder({ kind: 'prem', target: '628222222222', owner: '628222222222', chat: 'test', durationMs: 86400000, price: 2000 });
        assert.equal(second.order.price, 1800);
        const third = await payment.createPremOrder({ target: '628333333333', owner: '628222222222', chat: 'test', durationMs: 86400000, price: 2000 });
        assert.equal(third.order.price, 1800);
        assert.deepEqual(sent, [3750, 1800, 1800]);
    } finally {
        axios.post = originalPost;
        payment.stop();
    }
});
