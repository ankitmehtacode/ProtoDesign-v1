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
                    <h2 style="color: #333;">Welcome, ${fullName}!</h2>
                    <p>We are thrilled to have you on board. ProtoDesign is your one-stop shop for high-quality 3D printed parts.</p>
                    <p>Start browsing our catalog or upload your custom models today!</p>
                    <br/>
                    <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Go to Store</a>
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
        const resetLink = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${token}`;

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
                    <h2 style="color: #333;">Hello ${fullName},</h2>
                    <p>${messageMap[status]}</p>
                    
                    <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <strong>Order ID:</strong> ${orderId}<br/>
                        <strong>New Status:</strong> <span style="text-transform: capitalize; color: #007bff;">${status}</span>
                    </div>

                    <p>Track your order status in your <a href="${process.env.CLIENT_URL || 'http://localhost:5173'}/orders">Dashboard</a>.</p>
                </div>
            `
        };
        return transporter.sendMail(mailOptions);
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
