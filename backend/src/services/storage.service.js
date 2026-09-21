import { v2 as cloudinary } from 'cloudinary';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import path from 'path';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// ─────────────────────────────────────────────────────────────────────────────
// Why uploads no longer pass through this server
//
// Lambda caps a synchronous invoke payload at 6MB. STL models routinely exceed
// that, so the browser uploads straight to S3 (models) or Cloudinary (media)
// using a short-lived credential minted here. The server never holds the bytes,
// which also means upload size is bounded by the storage provider, not by us.
// ─────────────────────────────────────────────────────────────────────────────

const STL_BUCKET = process.env.S3_STL_BUCKET;
const AWS_REGION = process.env.AWS_REGION || 'ap-southeast-1'; // matches the Neon project region and the S3 bucket in infra/template.yaml

// Lambda supplies credentials from its execution role; locally the SDK falls
// back to the standard credential chain (env vars, ~/.aws/credentials).
const s3 = new S3Client({ region: AWS_REGION });

const UPLOAD_URL_TTL_SECONDS = 300;      // 5 minutes to start the upload
const DOWNLOAD_URL_TTL_SECONDS = 300;    // 5 minutes to fetch a model
const MAX_STL_BYTES = 200 * 1024 * 1024; // 200MB

// Browsers and CAD tools disagree about the MIME type for STL, so accept the
// known spellings rather than a single value. The extension is checked too.
const ALLOWED_STL_TYPES = new Set([
    'model/stl',
    'application/sla',
    'application/vnd.ms-pki.stl',
    'application/octet-stream'
]);
const ALLOWED_STL_EXTENSIONS = new Set(['.stl', '.obj', '.3mf', '.step', '.stp']);

function assertBucketConfigured() {
    if (!STL_BUCKET) {
        throw Object.assign(new Error('S3_STL_BUCKET is not configured'), { status: 500 });
    }
}

export const storageService = {
    /**
     * Mint a presigned PUT for a customer model.
     *
     * The object key is generated here and namespaced by userId -- a
     * client-supplied key would let one user overwrite another's model. The
     * signature pins content type and length, so the URL cannot be reused to
     * upload something different or larger than was declared.
     */
    async createModelUploadUrl({ userId, filename, contentType, contentLength }) {
        assertBucketConfigured();

        if (!userId) throw Object.assign(new Error('userId is required'), { status: 400 });
        if (!filename) throw Object.assign(new Error('filename is required'), { status: 400 });

        const ext = path.extname(String(filename)).toLowerCase();
        if (!ALLOWED_STL_EXTENSIONS.has(ext)) {
            throw Object.assign(
                new Error(`Unsupported file type '${ext || 'none'}'. Allowed: ${[...ALLOWED_STL_EXTENSIONS].join(', ')}`),
                { status: 400 }
            );
        }

        const type = contentType || 'application/octet-stream';
        if (!ALLOWED_STL_TYPES.has(type)) {
            throw Object.assign(new Error(`Unsupported content type '${type}'`), { status: 400 });
        }

        const size = Number(contentLength);
        if (!Number.isFinite(size) || size <= 0) {
            throw Object.assign(new Error('A positive contentLength is required'), { status: 400 });
        }
        if (size > MAX_STL_BYTES) {
            throw Object.assign(
                new Error(`File is ${(size / 1024 / 1024).toFixed(1)}MB; the limit is ${MAX_STL_BYTES / 1024 / 1024}MB`),
                { status: 413 }
            );
        }

        const key = `quotes/models/${userId}/${randomUUID()}${ext}`;

        const uploadUrl = await getSignedUrl(
            s3,
            new PutObjectCommand({
                Bucket: STL_BUCKET,
                Key: key,
                ContentType: type,
                ContentLength: size
            }),
            { expiresIn: UPLOAD_URL_TTL_SECONDS }
        );

        return { uploadUrl, key, contentType: type, expiresIn: UPLOAD_URL_TTL_SECONDS };
    },

    /**
     * Confirm an object actually exists before a row is written that claims it
     * does. Without this the client could post a key it never uploaded.
     * Returns null when the object is absent.
     */
    async statModel(key) {
        assertBucketConfigured();
        try {
            const head = await s3.send(new HeadObjectCommand({ Bucket: STL_BUCKET, Key: key }));
            return { contentLength: head.ContentLength, contentType: head.ContentType };
        } catch (error) {
            if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return null;
            throw error;
        }
    },

    /**
     * Short-lived GET for a stored model. The bucket stays private: customer
     * models are proprietary designs, so access is granted per request to an
     * authorised caller rather than by making objects public.
     */
    async createModelDownloadUrl(key, filename) {
        assertBucketConfigured();
        return getSignedUrl(
            s3,
            new GetObjectCommand({
                Bucket: STL_BUCKET,
                Key: key,
                ResponseContentDisposition: filename
                    ? `attachment; filename="${filename.replace(/["\\]/g, '')}"`
                    : undefined
            }),
            { expiresIn: DOWNLOAD_URL_TTL_SECONDS }
        );
    },

    /**
     * Parameters for a signed browser-side Cloudinary upload. Only the folder
     * and timestamp are signed, so the caller cannot redirect the upload
     * elsewhere in the account.
     */
    createMediaUploadSignature({ folder = 'misc' } = {}) {
        const apiSecret = process.env.CLOUDINARY_API_SECRET;
        if (!apiSecret || !process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY) {
            throw Object.assign(new Error('Cloudinary is not configured'), { status: 500 });
        }

        const timestamp = Math.round(Date.now() / 1000);
        const scopedFolder = `protodesign/${folder}`;
        const signature = cloudinary.utils.api_sign_request(
            { folder: scopedFolder, timestamp },
            apiSecret
        );

        return {
            signature,
            timestamp,
            folder: scopedFolder,
            apiKey: process.env.CLOUDINARY_API_KEY,
            cloudName: process.env.CLOUDINARY_CLOUD_NAME
        };
    },

    /**
     * Server-to-server import for bulk product loads. This never handles a
     * browser upload, so the 6MB request ceiling does not apply.
     */
    async uploadFromUrl(url, folder = 'misc') {
        const result = await cloudinary.uploader.upload(url, {
            folder: `protodesign/${folder}`,
            resource_type: 'image'
        });
        return result.secure_url;
    }
};
