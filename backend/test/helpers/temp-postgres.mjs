import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

const freePort = () => new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address();
        srv.close(() => resolve(port));
    });
});

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', ...opts });

/**
 * Starts a disposable Postgres with the project's real migrations applied, so
 * tests exercise real SQL (transactions, row locks, constraints) instead of a
 * mock. SSL is on because src/config/database.js always connects with SSL.
 *
 * Requires the Postgres server binaries (initdb, pg_ctl) and psql on PATH --
 * the same tools `npm run db:setup` already needs.
 *
 * @returns {Promise<{url: string, stop: () => void}>}
 */
export async function startTempPostgres() {
    const dir = mkdtempSync(join(tmpdir(), 'protodesign-pg-'));
    const data = join(dir, 'data');
    const port = await freePort();
    const url = `postgres://postgres@127.0.0.1:${port}/protodesign_test`;

    const stop = () => {
        try { run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']); } catch { /* not started */ }
        rmSync(dir, { recursive: true, force: true });
    };

    try {
        run('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '-E', 'UTF8', '--no-locale']);
        run('openssl', ['req', '-new', '-x509', '-days', '1', '-nodes', '-subj', '/CN=localhost',
            '-out', join(data, 'server.crt'), '-keyout', join(data, 'server.key')]);
        chmodSync(join(data, 'server.key'), 0o600);

        run('pg_ctl', ['-D', data, '-w', '-l', join(dir, 'pg.log'),
            '-o', `-p ${port} -c listen_addresses=127.0.0.1 -c unix_socket_directories=${dir} -c ssl=on`, 'start']);

        const psql = (db, args) => run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres',
            '-v', 'ON_ERROR_STOP=1', '-d', db, ...args]);
        psql('postgres', ['-c', 'CREATE DATABASE protodesign_test']);
        for (const file of ['001_initial_schema.sql', '009_add_payment_status.sql', '010_add_product_slug.sql', '011_whatsapp.sql']) {
            psql('protodesign_test', ['-q', '-f', join(MIGRATIONS, file)]);
        }
    } catch (err) {
        stop();
        throw new Error(`Could not start temporary Postgres: ${err.stderr?.toString() || err.message}`);
    }

    return { url, stop };
}
