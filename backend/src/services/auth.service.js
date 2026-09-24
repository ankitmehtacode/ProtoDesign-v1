import db from '../config/database.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { emailService } from './email.service.js';
import { OAuth2Client } from 'google-auth-library'; // ✅ Added Import

// Authentication service
export const authService = {
    /**
     * User signup - Create new user account
     */
    async signup(email, password, fullName) {
        if (!email || !password || !fullName) {
            throw new Error('Email, password, and full name are required');
        }
        if (password.length < 8) {
            throw new Error('Password must be at least 8 characters');
        }

        const existing = await db.oneOrNone('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing) throw new Error('Email already registered');

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await db.one(
            `INSERT INTO users (email, password_hash, full_name)
             VALUES ($1, $2, $3)
                 RETURNING id, email, full_name, created_at`,
            [email.toLowerCase(), hashedPassword, fullName]
        );

        await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [user.id, 'user']);

        // Awaited: under Lambda a dangling promise is frozen with the container the
        // instant the response returns, so this would never actually send.
        try {
            await emailService.sendWelcomeEmail(user.email, user.full_name);
        } catch (err) {
            console.error(JSON.stringify({
                event: 'email_failed', type: 'welcome', userId: user.id, error: err.message
            }));
        }

        const token = this._generateToken(user.id, user.email, 'user');

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name || user.fullName, // Handle snake_case or camelCase from DB
                createdAt: user.created_at || user.createdAt
            },
            token,
            role: 'user'
        };
    },

    /**
     * User login - Authenticate existing user
     */
    async login(email, password) {
        if (!email || !password) throw Object.assign(new Error('Email and password are required'), { status: 400 });

        const user = await db.oneOrNone(
            'SELECT id, email, password_hash, full_name FROM users WHERE email = $1',
            [email.toLowerCase()]
        );

        // 401 with one message for both cases, so the response does not reveal which emails exist.
        if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

        // Check password (password_hash or passwordHash depending on DB config)
        const dbPass = user.password_hash || user.passwordHash;
        const passwordMatch = await bcrypt.compare(password, dbPass);

        if (!passwordMatch) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

        const role = await this._getUserRole(user.id);
        const token = this._generateToken(user.id, user.email, role);

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name || user.fullName,
                createdAt: user.created_at || user.createdAt
            },
            token,
            role
        };
    },

    /**
     * ✅ NEW: Login with Google
     */
    async loginWithGoogle(idToken) {
        const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

        // 1. Verify Token
        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const { email, name, picture } = ticket.getPayload();

        // 2. Check if user exists (Use db.oneOrNone)
        let user = await db.oneOrNone('SELECT * FROM users WHERE email = $1', [email]);
        let role = 'user';

        // 3. If no user, create one
        if (!user) {
            const randomPass = crypto.randomBytes(16).toString('hex');
            const hashedPass = await bcrypt.hash(randomPass, 10);

            // Insert User
            user = await db.one(
                `INSERT INTO users (full_name, email, password_hash) 
                 VALUES ($1, $2, $3) 
                 RETURNING id, email, full_name, created_at`,
                [name, email, hashedPass]
            );

            // Assign Role
            await db.none('INSERT INTO user_roles (user_id, role) VALUES ($1, $2)', [user.id, 'user']);

            // Send Welcome Email
            try {
                await emailService.sendWelcomeEmail(email, name);
            } catch (err) {
                console.error(JSON.stringify({
                    event: 'email_failed', type: 'welcome_google', userId: user.id, error: err.message
                }));
            }
        } else {
            // Get existing role
            role = await this._getUserRole(user.id);
        }

        // 4. Generate Token
        const token = this._generateToken(user.id, user.email, role);

        return {
            user: {
                id: user.id,
                full_name: user.full_name || user.fullName,
                email: user.email,
                role: role,
                avatar: picture
            },
            token
        };
    },

    // --- Helper Methods ---

    async _getUserRole(userId) {
        const userRole = await db.oneOrNone(
            `SELECT role FROM user_roles WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [userId]
        );
        return userRole?.role || 'user';
    },

    _generateToken(userId, email, role) {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not defined');

    // 1. Get the raw value
    let expiry = process.env.JWT_EXPIRY || '7d';

    // 2. CHECK: Is it just digits? (e.g., "3600" or "86400")
    // If yes, parse it to an Integer so jwt treats it as SECONDS.
    if (/^\d+$/.test(expiry)) {
        expiry = parseInt(expiry, 10);
    }

    // 3. Sign the token
    return jwt.sign(
        { userId, email, role },
        process.env.JWT_SECRET,
        { expiresIn: expiry }
    );
},

    // ... (Keep existing verifyToken, getUserById, changePassword, forgotPassword, resetPassword methods unchanged)

    async verifyToken(token) {
        try {
            if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not defined');
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            return { valid: true, decoded };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    },

    async getUserById(userId) {
        const user = await db.oneOrNone(
            'SELECT id, email, full_name, created_at FROM users WHERE id = $1',
            [userId]
        );
        if (!user) throw new Error('User not found');
        return {
            id: user.id,
            email: user.email,
            fullName: user.full_name || user.fullName,
            createdAt: user.created_at || user.createdAt
        };
    },

    async forgotPassword(email) {
        const user = await db.oneOrNone('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (!user) throw new Error('User not found');

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 3600000);

        await db.none(
            'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
            [resetToken, tokenExpiry, user.id]
        );

        await emailService.sendPasswordResetEmail(email, resetToken);
        return { message: 'Password reset email sent' };
    },

    async resetPassword(token, newPassword) {
        if (!token || !newPassword) throw new Error('Missing token or password');

        const user = await db.oneOrNone(
            `SELECT id FROM users WHERE reset_password_token = $1 AND reset_password_expires > NOW()`,
            [token]
        );

        if (!user) throw new Error('Invalid or expired token');

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.none(
            `UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2`,
            [hashedPassword, user.id]
        );

        return { message: 'Password successfully reset' };
    },

    async changePassword(userId, oldPassword, newPassword) {
        if (!oldPassword || !newPassword) throw new Error('Both old and new passwords are required');
        if (newPassword.length < 8) throw new Error('New password must be at least 8 characters');

        const user = await db.oneOrNone('SELECT password_hash FROM users WHERE id = $1', [userId]);
        if (!user) throw new Error('User not found');

        const dbPass = user.password_hash || user.passwordHash;
        const passwordMatch = await bcrypt.compare(oldPassword, dbPass);
        if (!passwordMatch) throw new Error('Current password is incorrect');

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        await db.none('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);
    }
};
