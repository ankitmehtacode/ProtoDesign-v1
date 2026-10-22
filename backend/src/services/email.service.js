// backend/src/services/email.service.js
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

// Create Transporter
// 💡 TIP: For Gmail, you MUST use an "App Password" if 2FA is on.
// otherwise use Ethereal.email for testing without real emails.
const transporter = nodemailer.createTransport({
    service: 'gmail', // or 'smtp.ethereal.email'
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// The eager transporter.verify() that used to live here has been removed. It
// opened a real SMTP handshake to Gmail on every module load -- meaning every
// Lambda cold start -- while gating nothing: its result was logged and discarded,
// and a failure did not stop the app from starting. Send failures are reported at
// the call sites, which is where they can actually be acted on.
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn(JSON.stringify({
        event: 'email_not_configured',
        detail: 'EMAIL_USER/EMAIL_PASS unset; outbound mail will fail'
    }));
}

// The shop's address for links in emails. FRONTEND_URL is what the stack
// sets (infra/template.yaml); CLIENT_URL is the older local-dev name.
const siteUrl = () => (process.env.FRONTEND_URL || process.env.CLIENT_URL || 'https://www.protodesignstudio.com').replace(/\/+$/, '');

const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const inr = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const orderRef = (orderId) => `#${orderId.slice(0, 8).toUpperCase()}`;

/**
 * The refund email: tells the customer their money is on its way back. Sent
 * once, when an admin marks the order refunded (order.service.js refundOrder),
 * which they do after starting the refund with PhonePe or paying it back by
 * hand. Always the whole order total. 5-7 working days is the Refund Policy's
 * promise (src/pages/Legal.tsx); keep the two the same.
 */
export function refundEmail(fullName, order) {
    const ref = orderRef(order.id);
    const amount = inr(order.total_amount);
    const firstName = String(fullName ?? '').trim().split(/\s+/)[0] || 'there';
    const placed = new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const cash = String(order.payment_gateway ?? '').toLowerCase() === 'cod';
    // The admin marks an order refunded only after sending the money
    // (OrdersSection.tsx): by PhonePe to the original method, or for cash on
    // delivery to the UPI ID or bank account the customer gave.
    const where = cash
        ? 'to the UPI ID or bank account you gave us.'
        : 'to the UPI app, card or bank account you paid with. You do not need to do anything.';
    const ordersUrl = `${siteUrl()}/orders`;

    const text = [
        `Hi ${firstName},`,
        '',
        `We've initiated a refund of ${amount} for your ProtoDesign order ${ref}.`,
        '',
        `When: it will reach you within 5-7 working days. Many banks show it sooner.`,
        `Where: ${where}`,
        '',
        `Order: ${ref}, placed ${placed}`,
        `Refund amount: ${amount}`,
        '',
        `If it hasn't arrived after 7 working days, reply to this email with your order number and we'll send you the refund's transaction reference to check with your bank.`,
        '',
        `Your orders: ${ordersUrl}`,
        '',
        'Thank you for your patience,',
        'ProtoDesign',
    ].join('\n');

    const row = (label, value) => `<tr><td style="padding: 6px 0; color: #666;">${label}</td><td style="padding: 6px 0; text-align: right;"><strong>${value}</strong></td></tr>`;
    const html = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #222;">
                <h2 style="color: #333;">Hello ${escapeHtml(firstName)},</h2>
                <p>We've initiated a refund of <strong>${amount}</strong> for your order <strong>${ref}</strong>.</p>

                <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        ${row('Order', ref)}
                        ${row('Placed', placed)}
                        ${row('Refund amount', amount)}
                        ${row('Expected', 'Within 5–7 working days')}
                    </table>
                </div>

                <p><strong>Where it goes:</strong> ${where}</p>
                <p>Many banks show the refund sooner. If it hasn't arrived after 7 working days, reply to this email with your order number and we'll send you the refund's transaction reference to check with your bank.</p>

                <p>See your orders in your <a href="${ordersUrl}">Dashboard</a>.</p>
                <p>Thank you for your patience,<br/>ProtoDesign</p>
            </div>
        `;

    return { subject: `Refund of ${amount} initiated for order ${ref}`, text, html };
}

export const emailService = {
    /**
     * Send Welcome Email
     */
    async sendWelcomeEmail(email, fullName) {
        const mailOptions = {
            from: `"ProtoDesign Team" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Welcome to ProtoDesign! 🚀',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Welcome, ${escapeHtml(fullName)}!</h2>
                    <p>We are thrilled to have you on board. ProtoDesign is your one-stop shop for high-quality 3D printed parts.</p>
                    <p>Start browsing our catalog or upload your custom models today!</p>
                    <br/>
                    <a href="${siteUrl()}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Store</a>
                </div>
            `
        };
        return transporter.sendMail(mailOptions);
    },

    /**
     * Send Password Reset Email
     */
    async sendPasswordResetEmail(email, token) {
        // Construct reset link (Frontend URL)
        const resetLink = `${siteUrl()}/reset-password?token=${token}`;

        const mailOptions = {
            from: `"ProtoDesign Security" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Password Reset Request 🔒',
            html: `
                <div style="font-family: Arial, sans-serif;">
                    <h3>Password Reset Request</h3>
                    <p>You requested a password reset. Click the link below to set a new password:</p>
                    <p><a href="${resetLink}">Reset Password</a></p>
                    <p><small>This link expires in 1 hour.</small></p>
                    <p>If you didn't request this, please ignore this email.</p>
                </div>
            `
        };
        return transporter.sendMail(mailOptions);
    },

    /**
     * Send Order Confirmation
     */
    async sendOrderConfirmation(email, orderId, totalAmount, items) {
        const itemList = items.map(item =>
            `<li>${item.quantity}x <strong>${item.product_name || 'Product'}</strong> - ₹${item.price}</li>`
        ).join('');

        const mailOptions = {
            from: `"ProtoDesign Orders" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `Order Confirmation #${orderId.slice(0, 8)} ✅`,
            html: `
                <div style="font-family: Arial, sans-serif;">
                    <h2>Thank you for your order!</h2>
                    <p>Your order <strong>#${orderId}</strong> has been placed successfully.</p>
                    <h3>Order Summary:</h3>
                    <ul>${itemList}</ul>
                    <p><strong>Total Paid: ₹${totalAmount}</strong></p>
                    <br/>
                    <p>We will notify you when your items are shipped.</p>
                </div>
            `
        };
        return transporter.sendMail(mailOptions);
    },

    async sendOrderStatusEmail(email, fullName, orderId, status) {
        const subjectMap = {
            'shipped': '📦 Your Order has Shipped!',
            'delivered': '🎉 Your Order has been Delivered!',
            'cancelled': '⚠️ Order Cancellation Notice'
        };

        const messageMap = {
            'shipped': 'Great news! Your items are on the way. They should arrive soon.',
            'delivered': 'Your order has been marked as delivered. We hope you enjoy your prints!',
            'cancelled': 'Your order has been cancelled. If you did not request this, please contact support.'
        };

        if (!subjectMap[status]) return; // Don't send emails for 'processing' or 'pending' updates

        const mailOptions = {
            from: `"ProtoDesign Updates" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `${subjectMap[status]} #${orderId.slice(0, 8)}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Hello ${escapeHtml(fullName)},</h2>
                    <p>${messageMap[status]}</p>
                    
                    <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <strong>Order ID:</strong> ${orderId}<br/>
                        <strong>New Status:</strong> <span style="text-transform: capitalize; color: #007bff;">${status}</span>
                    </div>

                    <p>Track your order status in your <a href="${siteUrl()}/orders">Dashboard</a>.</p>
                </div>
            `
        };
        return transporter.sendMail(mailOptions);
    },

    /** Sends refundEmail(). */
    async sendRefundEmail(email, fullName, order) {
        return transporter.sendMail({ from: `"ProtoDesign Orders" <${process.env.EMAIL_USER}>`, to: email, ...refundEmail(fullName, order) });
    },

    /** Asks the owner of the address to confirm a product alert (double opt-in, product-alerts.service.js). */
    async sendAlertConfirmation(to, { productName, kind, price, productUrl, confirmUrl, unsubscribeUrl }) {
        const what = kind === 'back_in_stock'
            ? `when ${productName} is back in stock`
            : `if the price of ${productName} drops below ₹${Number(price).toLocaleString('en-IN')}`;
        return transporter.sendMail({
            from: `"ProtoDesign" <${process.env.EMAIL_USER}>`,
            to,
            subject: `Confirm your alert for ${productName}`,
            text: `Someone, hopefully you, asked us to email this address ${what}.\n\n`
                + `To turn the alert on, confirm here: ${confirmUrl}\n\n`
                + `If it wasn't you, ignore this email and nothing more will be sent. `
                + `To be sure, you can also cancel it: ${unsubscribeUrl}\n\n${productUrl}\n\nProtoDesign`,
        });
    },

    /** The alert itself: back in stock, or a lower price. */
    async sendProductAlert(to, { productName, kind, price, was, saleEnds = null, productUrl, unsubscribeUrl }) {
        const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
        const backInStock = kind === 'back_in_stock';
        // The last day of a sale whose end is exclusive midnight, in IST.
        const until = saleEnds
            ? ` This is a sale price, until ${new Date(Date.parse(saleEnds) - 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}.`
            : '';
        return transporter.sendMail({
            from: `"ProtoDesign" <${process.env.EMAIL_USER}>`,
            to,
            subject: backInStock ? `${productName} is back in stock` : `${productName} is now ${inr(price)}`,
            text: (backInStock
                ? `Good news: ${productName} is back in stock at ${inr(price)}.${until}`
                : `${productName} has dropped from ${inr(was)} to ${inr(price)}.${until}`)
                + `\n\n${productUrl}\n\nQuestions? Reply to this email or WhatsApp us.\n\n`
                + `This was a one-time alert you asked for. Unsubscribe: ${unsubscribeUrl}\n\nProtoDesign`,
        });
    },

    /**
     * Plain-text alert to the shop's own inbox (EMAIL_USER), e.g. a new
     * WhatsApp conversation or a model file sent in chat.
     */
    async sendAdminAlert(subject, text) {
        return transporter.sendMail({
            from: `"ProtoDesign System" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject,
            text
        });
    }

};
