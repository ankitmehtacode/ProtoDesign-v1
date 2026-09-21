process.env.S3_STL_BUCKET = 'protodesign-models-test';
process.env.AWS_REGION = 'ap-southeast-1'; // matches the Neon project's region
process.env.AWS_ACCESS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
process.env.AWS_SECRET_ACCESS_KEY = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
process.env.CLOUDINARY_CLOUD_NAME = 'demo';
process.env.CLOUDINARY_API_KEY = '123456789';
process.env.CLOUDINARY_API_SECRET = 'testsecret';

const { storageService } = await import('../src/services/storage.service.js');

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const rejects = async (name, fn, expectStatus) => {
    try { await fn(); check(name, false, '(expected rejection, got success)'); }
    catch (e) { check(`${name} -> ${e.status} ${e.message.slice(0,50)}`, e.status === expectStatus, `(got ${e.status})`); }
};

console.log('\n-- rejects bad input --');
await rejects('executable extension', () => storageService.createModelUploadUrl(
    { userId: 'u1', filename: 'evil.exe', contentType: 'application/octet-stream', contentLength: 100 }), 400);
await rejects('no extension', () => storageService.createModelUploadUrl(
    { userId: 'u1', filename: 'model', contentType: 'application/octet-stream', contentLength: 100 }), 400);
await rejects('bad content type', () => storageService.createModelUploadUrl(
    { userId: 'u1', filename: 'a.stl', contentType: 'text/html', contentLength: 100 }), 400);
await rejects('oversize (300MB)', () => storageService.createModelUploadUrl(
    { userId: 'u1', filename: 'a.stl', contentType: 'model/stl', contentLength: 300*1024*1024 }), 413);
await rejects('zero length', () => storageService.createModelUploadUrl(
    { userId: 'u1', filename: 'a.stl', contentType: 'model/stl', contentLength: 0 }), 400);
await rejects('missing userId', () => storageService.createModelUploadUrl(
    { filename: 'a.stl', contentType: 'model/stl', contentLength: 100 }), 400);

console.log('\n-- accepts a valid model --');
const ok = await storageService.createModelUploadUrl({
    userId: 'user-abc', filename: 'bracket v2.stl', contentType: 'model/stl', contentLength: 5*1024*1024
});
check('key namespaced by userId', ok.key.startsWith('quotes/models/user-abc/'), ok.key);
check('key does not echo user filename', !ok.key.includes('bracket'), ok.key);
check('url is presigned PUT', ok.uploadUrl.includes('X-Amz-Signature='));
check('signature pins content length', ok.uploadUrl.includes('content-length'), ok.uploadUrl.slice(0,200));
check('short TTL', ok.uploadUrl.includes('X-Amz-Expires=300'));

console.log('\n-- key ownership cannot be forged across users --');
const other = await storageService.createModelUploadUrl({
    userId: 'user-xyz', filename: 'a.stl', contentType: 'model/stl', contentLength: 100
});
check('different users get different prefixes', !other.key.startsWith('quotes/models/user-abc/'), other.key);

console.log('\n-- cloudinary signature --');
const sig = storageService.createMediaUploadSignature({ folder: 'products' });
check('folder is namespaced', sig.folder === 'protodesign/products', sig.folder);
check('signature present', typeof sig.signature === 'string' && sig.signature.length === 40);
check('secret not leaked', !JSON.stringify(sig).includes('testsecret'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
