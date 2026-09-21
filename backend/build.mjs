// backend/build.mjs
// Bundles the Express app into a single ESM file for Lambda.
//
// Why a bundle at all: the app is run locally by `tsx`, which Lambda cannot do.
// Bundling also collapses node_modules into one file, which keeps the cold-start
// unpack fast and the deployment artifact small.
import { build } from 'esbuild';

await build({
    entryPoints: ['app.ts'],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    outfile: 'dist/lambda.mjs',
    // pg ships an optional native binding it only require()s if present. It is
    // not installed and not wanted (native modules must be built for the Lambda
    // runtime, not the dev machine), so keep it out of the graph.
    external: ['pg-native'],
    // esbuild's ESM output has no `require`, but several dependencies are CJS
    // and call it internally. This shim restores it.
    banner: {
        js: "import{createRequire}from'module';const require=createRequire(import.meta.url);"
    },
    logLevel: 'info',
    metafile: false
});
