// The quote request's contact fallback and the emails it sends.
//
//   tsx --test test/quote.email.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { quoteAdminEmail, quoteContact, quoteCustomerEmail } from '../src/services/quote.email.js';

const account = { email: 'buyer@example.com', full_name: 'Asha Rao', phone_number: null };

describe('quoteContact', () => {
    it('falls back to the account email when the form left it blank', () => {
        const c = quoteContact({ email: '  ', phone: '98765 43210' }, account);
        assert.equal(c.email, 'buyer@example.com');
        assert.equal(c.name, 'Asha Rao');
        assert.equal(c.problem, null);
    });

    it('prefers what the customer typed', () => {
        assert.equal(quoteContact({ email: 'other@example.com', phone: '9876543210' }, account).email, 'other@example.com');
    });

    it('accepts exactly one email address', () => {
        assert.match(quoteContact({ email: 'a@x.com, b@y.com', phone: '9876543210' }, account).problem, /valid email/);
        assert.match(quoteContact({ email: 'Bob <b@y.com>', phone: '9876543210' }, account).problem, /valid email/);
        assert.match(quoteContact({ email: 'not-an-email', phone: '9876543210' }, account).problem, /valid email/);
    });

    it('refuses a phone with anything but digits and separators', () => {
        assert.match(quoteContact({ phone: 'abc1234567890xyz' }, account).problem, /phone number/);
        assert.equal(quoteContact({ phone: '+91 (98765) 43210' }, account).problem, null);
    });

    it('falls back to the account phone, and refuses a quote with no phone at all', () => {
        assert.equal(quoteContact({ phone: '' }, { ...account, phone_number: '+91 98765-43210' }).problem, null);
        assert.match(quoteContact({ phone: '' }, account).problem, /phone number/);
        assert.match(quoteContact({ phone: '12345' }, account).problem, /phone number/);
    });
});

describe('quoteAdminEmail', () => {
    const base = {
        quoteId: '0b7c4f1e-1111-2222-3333-444455556666',
        contact: { email: 'buyer@example.com', phone: '98765 43210', name: 'Asha Rao' },
        fileName: 'tinker.obj',
        fileSize: 2 * 1024 * 1024,
        specs: { material: 'ABS - Black', estimatedPrice: 154, printDimensions: { x: 4.7, y: 0.2, z: 0.99 }, originalStats: { volume: 0.4 } },
        notes: '',
        adminUrl: 'https://www.protodesignstudio.com/admin?tab=quotes',
    };

    it('gives the team a way to reach the customer and to get the model', () => {
        const { subject, html } = quoteAdminEmail(base);
        assert.equal(subject, 'New quote: tinker.obj - ₹154 - Asha Rao');
        assert.match(html, /href="mailto:buyer@example.com"/);
        assert.match(html, /href="tel:98765 43210"/);
        assert.match(html, /href="https:\/\/wa.me\/919876543210"/);
        assert.match(html, /href="https:\/\/www.protodesignstudio.com\/admin\?tab=quotes"/);
        assert.match(html, /2\.00 MB/);
        assert.doesNotMatch(html, /User ID/);
    });

    it('links WhatsApp for a local number written with the trunk 0 or with +91', () => {
        for (const phone of ['098765 43210', '+91 98765 43210', '9876543210']) {
            assert.match(quoteAdminEmail({ ...base, contact: { ...base.contact, phone } }).html, /wa\.me\/919876543210"/, phone);
        }
    });

    it('escapes everything the customer controls', () => {
        const { html } = quoteAdminEmail({
            ...base,
            fileName: '<img src=x onerror=alert(1)>.stl',
            notes: '"><script>alert(1)</script>',
            contact: { ...base.contact, name: '<b>x</b>', email: 'a"onmouseover="x@example.com' },
        });
        assert.doesNotMatch(html, /<script>|<img |<b>x|"onmouseover/);
        assert.match(html, /&lt;script&gt;/);
    });
});

describe('quoteCustomerEmail', () => {
    it('greets the customer by name and shows the estimate', () => {
        const { html } = quoteCustomerEmail({ contact: { name: 'Asha Rao' }, specs: { estimatedPrice: 154 } });
        assert.match(html, /Hi Asha Rao,/);
        assert.match(html, /₹154/);
    });

    it('carries no text the caller chose, so it cannot be turned into a message to someone else', () => {
        const { subject, html } = quoteCustomerEmail({
            contact: { name: '' }, fileName: 'verify at evil-pay.in.stl', specs: { estimatedPrice: '0 - call 99999 99999' },
        });
        assert.equal(subject, 'We received your 3D print quote request');
        assert.doesNotMatch(html, /evil-pay|99999/);
    });
});
