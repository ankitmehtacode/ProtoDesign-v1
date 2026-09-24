// src/services/api.service.ts

// @ts-ignore
const API_URL = import.meta.env.VITE_API_URL || "/api";

interface RequestOptions extends RequestInit {
    skipAuth?: boolean;
}

class ApiService {
    private token: string | null = null;

    constructor() {
        if (typeof window !== "undefined") {
            this.token = localStorage.getItem("auth_token");
        }
    }

    private buildHeaders(includeAuth: boolean, body?: BodyInit | null): HeadersInit {
        const headers: Record<string, string> = {};

        if (!(body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
        }

        if (includeAuth && this.token) {
            headers["Authorization"] = `Bearer ${this.token}`;
        }

        return headers;
    }

    public async request(
        endpoint: string,
        options: RequestOptions = {}
    ): Promise<any> {
        const url = `${API_URL}${endpoint}`;
        const includeAuth = options.skipAuth ? false : true;
        const headers = this.buildHeaders(includeAuth, options.body ?? null);

        const res = await fetch(url, {
            ...options,
            headers: {
                ...headers,
                ...(options.headers || {}),
            },
        });

        const contentType = res.headers.get("content-type") || "";

        if (!res.ok) {
            if (res.status === 401 && !options.skipAuth) {
                this.clearToken();
                if (window.location.pathname !== '/auth') {
                    window.location.href = '/auth';
                }
            }

            let errBody: any = {};
            if (contentType.includes("application/json")) {
                errBody = await res.json().catch(() => ({}));
            } else {
                const text = await res.text().catch(() => "");
                errBody = { message: text };
            }

            const msg =
                errBody?.error?.message ||
                errBody?.error ||
                errBody?.message ||
                `HTTP ${res.status}`;
            throw new Error(msg);
        }

        if (contentType.includes("application/json")) {
            return res.json();
        }

        return res.text().catch(() => "");
    }

    setToken(token: string) {
        this.token = token;
        localStorage.setItem("auth_token", token);
    }

    clearToken() {
        this.token = null;
        localStorage.removeItem("auth_token");
    }

    getToken() {
        return this.token;
    }

    isAuthenticated() {
        return !!this.token;
    }

    async signup(email: string, password: string, fullName: string) {
        const data = await this.request("/auth/signup", {
            method: "POST",
            body: JSON.stringify({ email, password, fullName }),
            skipAuth: true,
        });

        if (data.token) {
            this.setToken(data.token);
        }

        return data;
    }

    async register(fullName: string, email: string, password: string) {
        return this.signup(email, password, fullName);
    }

    async login(email: string, password: string) {
        const data = await this.request("/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
            skipAuth: true,
        });

        if (data.token) {
            this.setToken(data.token);
        }

        return data;
    }

    async loginWithGoogle(token: string) {
        const data = await this.request("/auth/google", {
            method: "POST",
            body: JSON.stringify({ token }),
            skipAuth: true,
        });

        if (data.token) {
            this.setToken(data.token);
        }

        return data;
    }

    async logout() {
        this.clearToken();
    }

    async getCurrentUser() {
        return this.request("/auth/me");
    }

    async forgotPassword(email: string) {
        return this.request("/auth/forgot-password", {
            method: "POST",
            body: JSON.stringify({ email }),
            skipAuth: true,
        });
    }

    async resetPassword(token: string, newPassword: string) {
        return this.request("/auth/reset-password", {
            method: "POST",
            body: JSON.stringify({ token, newPassword }),
            skipAuth: true,
        });
    }

    async changePassword(oldPassword: string, newPassword: string) {
        return this.request("/auth/change-password", {
            method: "POST",
            body: JSON.stringify({ oldPassword, newPassword })
        });
    }

    async getUserProfile() {
        return this.request("/user/profile");
    }

    async updateUserProfile(data: { fullName?: string; phoneNumber?: string; avatarUrl?: string }) {
        return this.request("/user/profile", {
            method: "PUT",
            body: JSON.stringify(data)
        });
    }

    async getAddresses() {
        return this.request("/user/addresses");
    }

    async addAddress(address: any) {
        return this.request("/user/addresses", {
            method: "POST",
            body: JSON.stringify(address)
        });
    }

    async updateAddress(id: string, address: any) {
        return this.request(`/user/addresses/${id}`, {
            method: "PUT",
            body: JSON.stringify(address)
        });
    }

    async deleteAddress(id: string) {
        return this.request(`/user/addresses/${id}`, { method: "DELETE" });
    }

    async getSavedModels() {
        return this.request("/user/models");
    }

    async bulkUploadProducts(file: File) {
        const formData = new FormData();
        formData.append('file', file);
        return this.request('/products/bulk', {
            method: 'POST',
            body: formData,
        });
    }

    async getProducts(category?: string | null, subCategory?: string | null, search?: string | null) {
        const params = new URLSearchParams();

        if (category && category !== 'all') params.append("category", category);
        if (subCategory && subCategory !== 'all') params.append("sub_category", subCategory);
        if (search) params.append("search", search);

        const query = params.toString() ? `?${params.toString()}` : "";
        return this.request(`/products${query}`, { method: "GET" });
    }

    async getProduct(id: string) {
        return this.request(`/products/${id}`, { method: "GET" });
    }

    async createProduct(productData: any | FormData) {
        const isForm = productData instanceof FormData;
        return this.request("/products", {
            method: "POST",
            body: isForm ? productData : JSON.stringify(productData),
        });
    }

    async updateProduct(id: string, productData: any | FormData) {
        const isForm = productData instanceof FormData;
        return this.request(`/products/${id}`, {
            method: "PUT",
            body: isForm ? productData : JSON.stringify(productData),
        });
    }

    // ✅ UPDATED: Supports permanent delete
    async deleteProduct(id: string, permanent: boolean = false) {
        const query = permanent ? '?permanent=true' : '';
        return this.request(`/products/${id}${query}`, { method: "DELETE" });
    }

    async getCart() {
        return this.request("/cart");
    }

    async addToCart(productId: string, quantity: number = 1) {
        return this.request("/cart/items", {
            method: "POST",
            body: JSON.stringify({ product_id: productId, quantity }),
        });
    }

    async updateCartItem(productId: string, quantity: number) {
        return this.request(`/cart/items/${productId}`, {
            method: "PUT",
            body: JSON.stringify({ quantity }),
        });
    }

    async removeFromCart(productId: string) {
        return this.request(`/cart/items/${productId}`, {
            method: "DELETE",
        });
    }

    async clearCart() {
        return this.request("/cart", {
            method: "DELETE",
        });
    }

    async getOrders() {
        return this.request("/orders", { method: "GET" });
    }

    async getOrder(id: string) {
        return this.request(`/orders/${id}`, { method: "GET" });
    }

    // The server prices the order (subtotal, GST, shipping); it takes no amounts from here.
    async createOrder(items: any[], shippingAddress: any, paymentGateway: string) {
        return this.request('/orders', {
            method: 'POST',
            body: JSON.stringify({
                items,
                shippingAddress,
                paymentGateway
            }),
        });
    }

    async cancelOrder(orderId: string) {
        return this.request(`/orders/${orderId}/cancel`, { method: "POST" });
    }

    async updateOrderAddress(orderId: string, address: any) {
        return this.request(`/orders/${orderId}/address`, {
            method: "PUT",
            body: JSON.stringify({ address })
        });
    }

    async updateOrderStatus(id: string, status: string) {
        return this.request(`/orders/${id}`, {
            method: "PUT",
            body: JSON.stringify({ status }),
        });
    }

    async getAdminOrders() {
        return this.request("/orders/admin/all", { method: "GET" });
    }

    async getProductReviews(productId: string) {
        return this.request(`/products/${productId}/reviews`, { method: "GET" });
    }

    async addProductReview(productId: string, rating: number, comment: string) {
        return this.request(`/products/${productId}/reviews`, {
            method: "POST",
            body: JSON.stringify({ rating, comment }),
        });
    }

    async isProductLiked(productId: string) {
        return this.request(`/products/${productId}/likes`);
    }

    async likeProduct(productId: string) {
        return this.request(`/products/${productId}/like`, { method: 'POST' });
    }

    async unlikeProduct(productId: string) {
        return this.request(`/products/${productId}/like`, { method: 'DELETE' });
    }

    // ─────────────────────────────────────────────────────────────────────
    // Direct uploads
    //
    // The API runs on Lambda, which caps a request body at 6MB. Models and
    // product media therefore never pass through it: the browser asks for a
    // short-lived credential, uploads straight to S3 or Cloudinary, and sends
    // back only the resulting key or URL.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Upload a 3D model straight to S3. Returns the object key to attach to a
     * quote. `onProgress` receives 0..1.
     */
    async uploadModel(file: File, onProgress?: (fraction: number) => void): Promise<string> {
        const { uploadUrl, key, contentType } = await this.request("/quotes/upload-url", {
            method: "POST",
            body: JSON.stringify({
                filename: file.name,
                contentType: file.type || "application/octet-stream",
                contentLength: file.size,
            }),
        });

        // XHR rather than fetch: fetch cannot report upload progress, and these
        // files are large enough that a silent wait looks like a hang.
        await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", uploadUrl, true);
            xhr.setRequestHeader("Content-Type", contentType);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
            };
            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve();
                else reject(new Error(`Upload failed (${xhr.status}). Please try again.`));
            };
            xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
            xhr.ontimeout = () => reject(new Error("Upload timed out. Please try again."));
            xhr.send(file);
        });

        return key;
    }

    /**
     * Upload product media straight to Cloudinary. Admin only -- the signature
     * endpoint enforces that. Returns the secure URL to store.
     */
    async uploadProductMedia(file: File, kind: "image" | "video" = "image"): Promise<string> {
        const sig = await this.request("/products/upload-signature", {
            method: "POST",
            body: JSON.stringify({ kind }),
        });

        const form = new FormData();
        form.append("file", file);
        form.append("api_key", sig.apiKey);
        form.append("timestamp", String(sig.timestamp));
        form.append("signature", sig.signature);
        form.append("folder", sig.folder);

        const endpoint = `https://api.cloudinary.com/v1_1/${sig.cloudName}/${kind === "video" ? "video" : "image"}/upload`;
        const res = await fetch(endpoint, { method: "POST", body: form });

        if (!res.ok) {
            const detail = await res.json().catch(() => ({}));
            throw new Error(detail?.error?.message || `Media upload failed (${res.status})`);
        }

        const data = await res.json();
        return data.secure_url;
    }

    /**
     * Quote models live in a private bucket, so a download is a short-lived
     * signed URL fetched on demand rather than a stored public link.
     */
    async getQuoteDownloadUrl(quoteId: string): Promise<string> {
        const { url } = await this.request(`/quotes/${quoteId}/download`);
        return url;
    }

    async sendQuoteRequest(payload: {
        fileKey: string;
        fileName: string;
        email: string;
        phone: string;
        notes?: string;
        specifications: string;
    }) {
        return this.request("/quotes/request", {
            method: "POST",
            body: JSON.stringify(payload),
        });
    }

    async getAllQuotes() {
        return this.request('/quotes/admin/all');
    }

    async updateQuoteStatus(id: string, status: string) {
        return this.request(`/quotes/${id}/status`, {
            method: 'PUT',
            body: JSON.stringify({ status })
        });
    }

    async getMyQuotes() {
        return this.request("/quotes/my");
    }

    async restoreProduct(id: string) {
        return this.request(`/products/${id}/restore`, { method: "PATCH" });
    }

}

export const apiService = new ApiService();