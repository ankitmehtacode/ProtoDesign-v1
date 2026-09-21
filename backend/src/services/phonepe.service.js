import axios from 'axios';
import { createHash, timingSafeEqual } from 'node:crypto';

// Load Config
const CLIENT_ID = process.env.PHONEPE_CLIENT_ID;
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET;
const CLIENT_VERSION = process.env.PHONEPE_CLIENT_VERSION || 1;
const ENV = process.env.PHONEPE_ENV || 'production';

// V2 Endpoints
const ENDPOINTS = {
    sandbox: {
        auth: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
        pay: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay",
        status: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order"
    },
    production: {
        auth: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
        pay: "https://api.phonepe.com/apis/pg/checkout/v2/pay",
        status: "https://api.phonepe.com/apis/pg/checkout/v2/order"
    }
};

const URLS = ENDPOINTS[ENV];

export const phonePeService = {
    /**
     * 1. Get OAuth Access Token
     */
    async getAccessToken() {
        try {
            const authHeader = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

            const params = new URLSearchParams();
            params.append('grant_type', 'client_credentials');
            params.append('client_id', CLIENT_ID);
            params.append('client_secret', CLIENT_SECRET);
            params.append('client_version', CLIENT_VERSION);

            const response = await axios.post(URLS.auth, params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${authHeader}`
                }
            });

            return response.data.access_token;
        } catch (error) {
            console.error("PhonePe Auth FAILED:", error.response?.data || error.message);
            throw new Error("Failed to authenticate with PhonePe Payment Gateway");
        }
    },

    /**
     * 2. Initiate Payment (V2)
     */
    async initiatePayment(orderId, amount, userId, mobileNumber) {
        try {
            console.log(`🔹 Initiating Payment for Order: ${orderId} (${amount})`);
            const token = await this.getAccessToken();

            // Use the UUID directly.
            const merchantOrderId = orderId;

            const payload = {
                merchantOrderId: merchantOrderId,
                amount: Math.round(amount * 100), // paise
                paymentFlow: {
                    type: "PG_CHECKOUT",
                    message: `Payment for Order ${merchantOrderId}`,
                    merchantUrls: {
                        // ✅ FIX: Don't hardcode success. Let the user check the real status on the Orders page.
                        redirectUrl: `${process.env.FRONTEND_URL}/orders`,
                        redirectMode: "REDIRECT",
                        callbackUrl: `${process.env.BACKEND_URL}/api/orders/payment/callback`
                    }
                }
            };

            const response = await axios.post(URLS.pay, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `O-Bearer ${token}`
                }
            });

            const responseData = response.data;
            console.log("🔹 PhonePe API Response:", JSON.stringify(responseData, null, 2));

            // ✅ ROBUST CHECK: Look for redirectUrl in all known locations
            let redirectUrl = null;

            // 1. Direct property (V2 Sandbox format)
            if (responseData.redirectUrl) {
                redirectUrl = responseData.redirectUrl;
            }
            // 2. Nested data property (V2 Production format often looks like this)
            else if (responseData.data && responseData.data.redirectUrl) {
                redirectUrl = responseData.data.redirectUrl;
            }
            // 3. Instrument Response (Legacy V1 format, just in case)
            else if (responseData.data && responseData.data.instrumentResponse && responseData.data.instrumentResponse.redirectInfo) {
                redirectUrl = responseData.data.instrumentResponse.redirectInfo.url;
            }

            if (redirectUrl) {
                console.log("✅ Redirect URL Found:", redirectUrl);
                return redirectUrl;
            } else {
                console.error("❌ Failed to parse Redirect URL. Available Keys:", Object.keys(responseData));
                const failureMsg = responseData.message || responseData.code || "Unknown Error";
                throw new Error(`PhonePe says: ${failureMsg}`);
            }

        } catch (error) {
            if (error.response) {
                console.error("❌ PhonePe HTTP Error:", error.response.status);
                console.error("❌ Response Body:", JSON.stringify(error.response.data, null, 2));
                throw new Error(error.response.data?.message || "Payment Gateway Error");
            } else {
                console.error("❌ Payment Logic Error:", error.message);
                throw error;
            }
        }
    },

    /**
     * Checks the Authorization header PhonePe sends with every webhook:
     * SHA256("<username>:<password>"), where the credentials are the ones set
     * in the PhonePe dashboard's webhook configuration.
     *
     * This is defense in depth, not the trust boundary: the order service never
     * acts on the webhook body, it re-queries PhonePe for the real state. The
     * header check just stops strangers from making us call PhonePe.
     *
     * Read at call time (not import time) so a rotated credential needs only a
     * config change, and so tests can set it.
     *
     * @returns {{configured: boolean, valid: boolean}} `configured` is false when
     *   the credentials are not set; callers must log that, not silently accept.
     */
    verifyCallbackAuth(authorizationHeader) {
        const username = process.env.PHONEPE_WEBHOOK_USERNAME;
        const password = process.env.PHONEPE_WEBHOOK_PASSWORD;
        if (!username || !password) return { configured: false, valid: false };
        if (typeof authorizationHeader !== 'string') return { configured: true, valid: false };

        const expected = createHash('sha256').update(`${username}:${password}`).digest('hex');
        // Tolerate an optional "SHA256 " scheme prefix; compare hex case-insensitively.
        const provided = authorizationHeader.trim().replace(/^sha256[\s=:]+/i, '').toLowerCase();

        // Hash both sides so the buffers are equal length for timingSafeEqual
        // regardless of what the caller sent.
        const a = createHash('sha256').update(provided).digest();
        const b = createHash('sha256').update(expected).digest();
        return { configured: true, valid: timingSafeEqual(a, b) };
    },

    /**
     * 3. Verify Payment Status
     */
    async verifyPaymentStatus(merchantOrderId) {
        try {
            const token = await this.getAccessToken();

            const response = await axios.get(
                `${URLS.status}/${merchantOrderId}/status`,
                {
                    headers: {
                        'Authorization': `O-Bearer ${token}`
                    }
                }
            );

            return response.data;
        } catch (error) {
            console.error("PhonePe Status Check Error:", error.message);
            throw error;
        }
    }
};