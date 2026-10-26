// Guest quotes: the upload token and the daily caps.
//
//   tsx --test test/guest-quote.test.mjs

import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { canonicalEmail, guestQuoteRefusal, signGuestUpload, verifyGuestUpload } from '../src/services/guest-quote.js';

const key = 'quotes/models/guest/0b6f9a52-6c1e-4a7e-9a55-3f1f5b0f9d11.stl';
const contact = { key, email: 'asha@example.com', phone: '98765 43210', fileName: 'bracket.stl' };

before(() => {
    process.env.JWT_SECRET = 'test-secret';
    delete process.env.GUEST_QUOTES_DAILY;
});

describe('guest upload token', () => {
    it('returns the contact it was signed for', () => {
        assert.deepEqual(verifyGuestUpload(signGuestUpload(contact), key),
            { email: 'asha@example.com', phone: '98765 43210', name: '', fileName: 'bracket.stl' });
    });

    it('does not cover another key', () => {
        assert.equal(verifyGuestUpload(signGuestUpload(contact), key.replace('0b6f', '1b6f')), null);
    });

    it('refuses a missing, forged or expired token', () => {
        assert.equal(verifyGuestUpload(undefined, key), null);
        assert.equal(verifyGuestUpload(jwt.sign(contact, 'other', { audience: 'guest-quote' }), key), null);
        const expired = jwt.sign({ ...contact, exp: Math.floor(Date.now() / 1000) - 10 },
            'test-secret:guest-quote', { audience: 'guest-quote' });
        assert.equal(verifyGuestUpload(expired, key), null);
    });

    it('is not interchangeable with a login token', () => {
        const session = jwt.sign({ userId: 'u1' }, 'test-secret');
        assert.equal(verifyGuestUpload(session, key), null);
        assert.throws(() => jwt.verify(signGuestUpload(contact), 'test-secret'));
    });
});

describe('canonicalEmail', () => {
    it('folds case, +tags and Gmail dots into one mailbox', () => {
        assert.equal(canonicalEmail(' A.Sha+quote@GoogleMail.com '), 'asha@gmail.com');
        assert.equal(canonicalEmail('a.sha+x@example.com'), 'a.sha@example.com');
    });
});

describe('guestQuoteRefusal', () => {
    const fakeDb = (usage) => ({ one: async () => usage });

    it('allows a guest under both caps', async () => {
        assert.equal(await guestQuoteRefusal(fakeDb({ total: 5, same_email: 2 }), 'a@x.com'), null);
    });

    it('stops a fourth quote to the same address in a day', async () => {
        assert.match(await guestQuoteRefusal(fakeDb({ total: 5, same_email: 3 }), 'a@x.com'), /several quotes/);
    });

    it('stops all guest quotes at the daily cap, which the environment can set', async () => {
        assert.match(await guestQuoteRefusal(fakeDb({ total: 40, same_email: 0 }), 'a@x.com'), /lot of quotes/);
        process.env.GUEST_QUOTES_DAILY = '100';
        assert.equal(await guestQuoteRefusal(fakeDb({ total: 40, same_email: 0 }), 'a@x.com'), null);
        delete process.env.GUEST_QUOTES_DAILY;
    });
});
