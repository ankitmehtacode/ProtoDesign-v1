import pgPromise from 'pg-promise';
import dotenv from 'dotenv';

dotenv.config();

const IS_LAMBDA = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);

const pgp = pgPromise();

if (!process.env.DATABASE_URL) {
    // Fail loudly at init rather than producing confusing per-query errors later.
    // Local dev is expected to set DATABASE_URL too (see .env.example).
    throw new Error('DATABASE_URL is not set. Refusing to start with an unknown database target.');
}

// Under Lambda each container serves exactly one request at a time, so a pool
// larger than 1 cannot be used by that container -- it can only multiply the
// connection count by the concurrency and exhaust the database. Point
// DATABASE_URL at the provider's POOLED endpoint (Neon: the '-pooler' host);
// that pooler, not this pool, is what absorbs concurrency.
const poolMax = IS_LAMBDA ? 1 : Number(process.env.DB_POOL_MAX || 10);

const db = pgp({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: poolMax,
    // Keep connections across warm invocations; reconnecting on every request
    // would add latency to the common path.
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000
});

// NOTE: no eager db.connect() here. It added a round-trip to every Lambda cold
// start, and its .catch() swallowed the failure -- the process carried on with a
// database it could not reach. Connection errors now surface on the query that
// actually needs the connection, where they can be handled and reported.

export { pgp };
export default db;
