import jwt from 'jsonwebtoken';

/*
 * Quotes from visitors without an account (routes/quotes.routes.js).
 *
 * A guest gives an email and phone number before the model is uploaded; a
 * quote nobody can be contacted about is no use to the team. The upload URL
 * comes with a signed token that binds the object key to that contact, so the
 * quote recorded afterwards cannot point at another guest's model or swap in
 * different contact details.
 *
 * The confirmation email goes to whatever address the guest typed, so guest
 * quotes are capped per address and per day: the form cannot be used to flood
 * someone's inbox or exhaust the shared Gmail sending budget.
 */

export const GUEST_OWNER = 'guest';
const TOKEN_AUDIENCE = 'guest-quote';
const TOKEN_TTL = '2h';
const PER_EMAIL_DAILY = 3;

// A key distinct from the session key: a guest token can never pass as a
// login token, nor a login token as a guest token.
const tokenSecret = () => {
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
    return `${process.env.JWT_SECRET}:${TOKEN_AUDIENCE}`;
};

export const guestDailyCap = () => {
    const cap = Number(process.env.GUEST_QUOTES_DAILY);
    return Number.isInteger(cap) && cap >= 0 ? cap : 40;
};

export function signGuestUpload({ key, email, phone, fileName }) {
    return jwt.sign({ key, email, phone, fileName: String(fileName).slice(0, 120) }, tokenSecret(),
        { audience: TOKEN_AUDIENCE, expiresIn: TOKEN_TTL });
}

/**
 * The contact and file name the upload was signed for, or null if the token
 * does not cover `key`. The file name comes from here, not the request body,
 * because it ends up in emails.
 */
export function verifyGuestUpload(token, key) {
    try {
        const claims = jwt.verify(String(token ?? ''), tokenSecret(), { audience: TOKEN_AUDIENCE });
        if (!key || claims.key !== key) return null;
        return { email: claims.email, phone: claims.phone, name: '', fileName: claims.fileName };
    } catch {
        return null;
    }
}

/**
 * One mailbox, however it is spelled: case, a +tag, and dots in a Gmail
 * address all reach the same inbox, so they share the per-address cap.
 * CANONICAL_EMAIL_SQL is the same rule for the stored column.
 */
export function canonicalEmail(email) {
    const [local = '', domain = ''] = String(email).trim().toLowerCase().split('@');
    const base = local.replace(/\+.*$/, '');
    return ['gmail.com', 'googlemail.com'].includes(domain) ? `${base.replace(/\./g, '')}@gmail.com` : `${base}@${domain}`;
}

const CANONICAL_EMAIL_SQL = `CASE WHEN split_part(lower(email), '@', 2) IN ('gmail.com', 'googlemail.com')
    THEN replace(regexp_replace(split_part(lower(email), '@', 1), '\\+.*$', ''), '.', '') || '@gmail.com'
    ELSE regexp_replace(split_part(lower(email), '@', 1), '\\+.*$', '') || '@' || split_part(lower(email), '@', 2) END`;

/**
 * Serialises guest quote inserts. Run inside the transaction that inserts, so
 * concurrent requests cannot all pass the caps before any of them is counted.
 */
export const lockGuestQuotes = (t) => t.any(`SELECT pg_advisory_xact_lock(hashtext('guest-quote'))`);

/** Why a guest may not send a quote right now, or null when they may. */
export async function guestQuoteRefusal(db, email) {
    const usage = await db.one(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE ${CANONICAL_EMAIL_SQL} = $1)::int AS same_email
           FROM quotes
          WHERE user_id IS NULL AND source = 'web' AND created_at > now() - interval '1 day'`,
        [canonicalEmail(email)]
    );
    if (usage.same_email >= PER_EMAIL_DAILY) {
        return 'You have sent several quotes today. Sign in to send more, or WhatsApp us.';
    }
    if (usage.total >= guestDailyCap()) {
        console.warn(JSON.stringify({ event: 'guest_quote_daily_cap_reached', cap: guestDailyCap() }));
        return 'We are taking a lot of quotes right now. Sign in to send yours, or WhatsApp us.';
    }
    return null;
}
