import db from '../config/database.js';

/**
 * Authoritative admin check. Must be mounted after authMiddleware, which sets
 * req.userId.
 *
 * The role is read from user_roles on every request rather than from the JWT,
 * so revoking an admin takes effect immediately instead of at token expiry.
 * A database fault is reported as a server error, not silently treated as
 * "not an admin".
 */
const isAdmin = async (req, res, next) => {
    if (!req.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const roleRow = await db.oneOrNone(
            'SELECT role FROM user_roles WHERE user_id = $1 AND role = $2',
            [req.userId, 'admin']
        );

        if (roleRow) return next();
        return res.status(403).json({ error: 'Admin access required' });
    } catch (error) {
        console.error(JSON.stringify({
            event: 'admin_check_failed', userId: req.userId, error: error.message
        }));
        return res.status(500).json({ error: 'Failed to verify admin privileges' });
    }
};

export default isAdmin;
