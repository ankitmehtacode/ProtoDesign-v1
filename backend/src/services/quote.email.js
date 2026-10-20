/**
 * Contact details and emails for a print quote request (routes/quotes.routes.js).
 *
 * Everything here comes from the customer -- form fields, the model's file name
 * and the specifications the browser computed -- so every value is escaped
 * before it is put into HTML.
 */

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const phoneDigits = (phone) => String(phone ?? '').replace(/\D/g, '');

// One address only: nodemailer reads "a@x.com, b@y.com" as two recipients, so a
// looser check would let a caller send our confirmation email to anyone.
const SINGLE_EMAIL = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;
// Digits, with the spaces, dashes, brackets and leading + people type; 10-15 digits.
const PHONE = /^\+?[0-9\s()-]+$/;

/**
 * Who to contact about a quote: what the customer typed, falling back to their
 * account for a blank field. Every account has an email; few have a phone, so
 * `problem` is set when there is no usable phone number to call back on.
 */
export function quoteContact(body, account) {
    const email = String(body?.email ?? '').trim() || account?.email || '';
    const phone = String(body?.phone ?? '').trim() || account?.phone_number || '';
    const name = account?.full_name || '';
    const digits = phoneDigits(phone).length;
    let problem = null;
    if (!SINGLE_EMAIL.test(email)) problem = 'Please enter a valid email so we can send your quote.';
    else if (!PHONE.test(phone) || digits < 10 || digits > 15) problem = 'Please enter a phone number so we can reach you about this quote.';
    return { email, phone, name, problem };
}

/**
 * wa.me wants the number with its country code and nothing else. A local
 * Indian number (98765 43210, or 098765 43210 with the trunk 0) gets +91;
 * anything else is taken to carry its own country code already.
 */
const whatsAppNumber = (phone) => {
    const digits = phoneDigits(phone).replace(/^0(?=\d{10}$)/, '');
    return digits.length === 10 ? `91${digits}` : digits;
};

const row = (label, html) => `<p style="margin: 5px 0; color: #cbd5e1;"><strong>${label}:</strong> ${html}</p>`;
const link = (href, text) => `<a href="${escapeHtml(href)}" style="color: #60a5fa;">${escapeHtml(text)}</a>`;

/**
 * The email to the ProtoDesign inbox. The model itself is private, so the
 * email links to the Quotes tab of the admin dashboard, where it downloads.
 */
export function quoteAdminEmail({ quoteId, contact, fileName, fileSize, specs, notes, adminUrl }) {
    const s = specs || {};
    const stats = s.originalStats || {};
    const dims = s.printDimensions || {};
    const volume = Number(stats.volume);
    const polygons = Number(s.polygonCount);
    const sizeMb = (Number(fileSize) / 1024 / 1024).toFixed(2);
    const wa = whatsAppNumber(contact.phone);

    const subject = `New quote: ${fileName} - ₹${s.estimatedPrice ?? 0}${contact.name ? ` - ${contact.name}` : ''}`;
    const html = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; border: 1px solid #1e293b; max-width: 600px; margin: 0 auto; border-radius: 8px; overflow: hidden; background-color: #0f172a; color: #e2e8f0;">
            <div style="background-color: #1e293b; padding: 20px; text-align: center; border-bottom: 2px solid #3b82f6;">
                <h2 style="color: #ffffff; margin: 0;">New 3D Printing Request</h2>
            </div>
            <div style="padding: 25px;">
                <div style="background: #1e293b; padding: 15px; border-radius: 6px; margin-bottom: 20px; border-left: 4px solid #3b82f6;">
                    <h3 style="margin-top: 0; color: #93c5fd; font-size: 16px; margin-bottom: 10px;">👤 Customer</h3>
                    ${contact.name ? row('Name', escapeHtml(contact.name)) : ''}
                    ${row('Email', link(`mailto:${contact.email}`, contact.email))}
                    ${row('Phone', `${link(`tel:${contact.phone}`, contact.phone)}${wa ? ` · ${link(`https://wa.me/${wa}`, 'WhatsApp')}` : ''}`)}
                </div>
                <div style="display: flex; gap: 15px; margin-bottom: 20px;">
                    <div style="flex: 1; background: #172554; padding: 15px; border-radius: 6px; border: 1px solid #1e3a8a;">
                        <h3 style="margin-top: 0; color: #60a5fa; font-size: 15px; margin-bottom: 10px;">⚙️ Settings</h3>
                        ${row('Material', escapeHtml(s.material))}
                        ${row('Quality', escapeHtml(s.quality))}
                        ${row('Infill', escapeHtml(s.infill))}
                        ${row('Scale', escapeHtml(s.scale || '100%'))}
                        ${row('Rotation', escapeHtml(s.rotation || 'X:0 Y:0 Z:0'))}
                    </div>
                    <div style="flex: 1; background: #27272a; padding: 15px; border-radius: 6px; border: 1px solid #3f3f46;">
                        <h3 style="margin-top: 0; color: #fb923c; font-size: 15px; margin-bottom: 10px;">📊 Model</h3>
                        ${row('Size', `${escapeHtml(dims.x)} × ${escapeHtml(dims.y)} × ${escapeHtml(dims.z)} cm`)}
                        ${row('Volume', `${Number.isFinite(volume) ? volume.toFixed(2) : 0} cm³`)}
                        ${row('Weight', escapeHtml(s.estimatedWeight || 'N/A'))}
                        ${row('Polygons', Number.isFinite(polygons) ? polygons.toLocaleString('en-IN') : 'N/A')}
                    </div>
                </div>
                <div style="border: 1px dashed #475569; padding: 15px; border-radius: 6px; margin-bottom: 25px;">
                    <h3 style="margin-top: 0; color: #94a3b8; font-size: 15px; margin-bottom: 5px;">📝 Customer notes</h3>
                    <p style="font-style: italic; color: #cbd5e1; margin: 0;">${escapeHtml(notes || 'None provided')}</p>
                </div>
                <div style="text-align: center;">
                    <span style="font-weight: bold; color: #94a3b8; margin-right: 15px;">Est. time: ${escapeHtml(s.estimatedTime)}</span>
                    <span style="font-weight: bold; color: #ffffff; font-size: 18px;">Total: ₹${escapeHtml(s.estimatedPrice ?? 0)}</span>
                </div>
            </div>
            <div style="background-color: #1e293b; padding: 14px; text-align: center; font-size: 13px; color: #94a3b8; border-top: 1px solid #334155;">
                ${link(adminUrl, 'Open in admin dashboard')} to download ${escapeHtml(fileName)} (${sizeMb} MB) · Quote ${escapeHtml(String(quoteId).slice(0, 8))}
            </div>
        </div>`;
    return { subject, html };
}

/** The confirmation to the customer. */
export function quoteCustomerEmail({ contact, fileName, specs }) {
    return {
        subject: `Order Received: ${fileName}`,
        html: `
            <div style="font-family: sans-serif; color: #333; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2563eb;">🚀 We received your request!</h2>
                <p>Hi ${escapeHtml(contact.name || 'there')},</p>
                <p>Thank you for submitting your model <strong>${escapeHtml(fileName)}</strong>.</p>
                <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <p><strong>Estimated Price:</strong> ₹${escapeHtml(specs?.estimatedPrice ?? 0)}</p>
                    <p><strong>Next Steps:</strong> Our engineers are reviewing the file for printability. We will contact you soon.</p>
                </div>
                <p>Best regards,<br><strong>The ProtoDesign Team</strong></p>
            </div>`,
    };
}
