import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
    Loader2,
    ShoppingCart,
    Heart,
    Star,
    Minus,
    Plus,
    Check,
    ChevronRight,
    Share2,
    PenLine,
    ArrowRight,
    Play,
    Save,
    X,
    Undo,
    Redo,
    Trash2,
    Upload,
    ImagePlus,
    Video,
    RefreshCcw,
    GripVertical,
    BadgeCheck
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { useCart } from "@/hooks/use-cart";
import { formatINR } from "@/lib/currency";
import { motion, AnimatePresence, Reorder, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { useDropzone } from 'react-dropzone';
import { Seo } from "@/seo/Seo";
import { CATEGORY_PAGES, SITE_URL, productDescription, productLd, productTitle, productUrl } from "@/seo/site.js";
import { CATEGORY_LABELS, dealBadge, dealPrice, isMadeToOrder } from '@/components/shop/product';
import { ProductPromises } from '@/components/shop/ProductPromises';
import { FestivalPriceNote } from '@/components/shop/FestivalPriceNote';
import { FreeGiftNote } from '@/components/shop/FreeGiftNote';
import { INTEREST_FOR_CATEGORY, LeadCapture } from '@/components/LeadCapture';
import { ProductAlert } from '@/components/ProductAlert';
import { track } from '@/lib/analytics';

// --- INTERFACES ---
interface ProductImage {
    id: string;
    image_url?: string;
    image_data?: string;
    display_order: number;
}

interface Product {
    id: string;
    slug?: string;
    name: string;
    description: string;
    short_description?: string;
    price: number;
    compare_at_price?: number | string | null;
    list_price?: number | string;
    festival?: { id: string; name: string; percent_off: number; ends_at: string; gift?: { product_id: string; quantity: number; label: string } } | null;
    stock: number;
    category: string;
    sub_category?: string;
    image_url?: string;
    product_images?: ProductImage[];
    totalSales?: number;
    likes_count?: number;
    average_rating?: number;
    review_count?: number;
    specifications?: Record<string, string> | Array<{ key: string; value: string }>;
    video_url?: string | null;
}

interface Review {
    id: string;
    user: string;
    rating: number;
    comment: string;
    created_at: string;
    verified_purchase?: boolean;
}

// --- EDITING INTERFACES ---
interface EditableSpec {
    id: string;
    key: string;
    value: string;
}

interface EditableProductState {
    name: string;
    description: string;
    short_description: string;
    price: number;
    stock: number;
    category: string;
    sub_category: string;
    specificationsArray: EditableSpec[];
    currentImages: ProductImage[];
    deletedImageIds: string[];
    newImageFiles: File[];
    newImagePreviews: string[];
    videoFile: File | null;
    videoPreview: string | null;
    deleteVideo: boolean;
    allowCodOverride: boolean; 
}

const CATEGORY_ROUTES: Record<string, string> = {
    '3d_printer': '/printers',
    '3dprintables': '/printables',
    'filament': '/filaments',
    'resin': '/resins',
    'accessory': '/accessories',
    'spare_part': '/spare-parts'
};

const StarRating = ({ rating, interactive = false, onRate, size = 16 }: { rating: number, interactive?: boolean, onRate?: (r: number) => void, size?: number }) => {
    const [hover, setHover] = useState(0);
    return (
        <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((star) => (
                <Star
                    key={star}
                    size={size}
                    className={`transition-colors duration-200 ${interactive ? 'cursor-pointer' : ''} 
            ${star <= (hover || rating) ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/60'}`}
                    onClick={() => interactive && onRate && onRate(star)}
                    onMouseEnter={() => interactive && setHover(star)}
                    onMouseLeave={() => interactive && setHover(0)}
                />
            ))}
        </div>
    );
};

/**
 * The surface product photos sit on, in both themes. Catalogue photos are shot
 * on white; on this near-white stage, with mix-blend-multiply, their white
 * melts away instead of showing as a bright box on the dark page.
 */
const STAGE = 'bg-[hsl(150_12%_94%)] dark:bg-[hsl(150_9%_86%)]';

const ImageMagnifier = ({ src, alt }: { src: string, alt: string }) => {
    const [showZoom, setShowZoom] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const imgRef = useRef<HTMLImageElement>(null);

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!imgRef.current) return;
        const { left, top, width, height } = imgRef.current.getBoundingClientRect();
        const x = ((e.clientX - left) / width) * 100;
        const y = ((e.clientY - top) / height) * 100;
        setPosition({ x, y });
    };

    return (
        <div
            className="relative w-full h-full overflow-hidden cursor-zoom-in flex items-center justify-center group"
            onMouseEnter={() => setShowZoom(true)}
            onMouseLeave={() => setShowZoom(false)}
            onMouseMove={handleMouseMove}
        >
            <img
                ref={imgRef}
                src={src}
                alt={alt}
                className={`w-full h-full object-contain p-6 sm:p-10 mix-blend-multiply transition-opacity duration-200 ${showZoom ? 'opacity-0' : 'opacity-100'}`}
            />
            {showZoom && (
                <div className={`absolute inset-0 overflow-hidden pointer-events-none ${STAGE}`}>
                    <img
                        src={src}
                        alt={`${alt} zoomed`}
                        className="absolute max-w-none mix-blend-multiply"
                        style={{
                            width: '250%',
                            height: '250%',
                            left: `${-position.x * 1.5}%`,
                            top: `${-position.y * 1.5}%`,
                            objectFit: 'contain'
                        }}
                    />
                </div>
            )}
        </div>
    );
};

/**
 * Up to this many specs sit in the buy box. A longer list gets its own
 * Specifications section instead, so no spec is shown twice.
 */
const GLANCE_SPECS = 6;

/** What buyers compare first; the buy box leads with these when a list is long. */
const KEY_SPEC_RE = /build (volume|size)|print(ing)? (size|volume)|technology|speed|filament compat|material|nozzle temp|screen|resolution|precision|layer/i;

/** Brands sold here, for products whose specs do not name one. */
const KNOWN_BRANDS = ['Bambu Lab', 'ELEGOO', 'Creality', 'Anycubic', 'Phrozen', 'Snapmaker', 'Prusa', 'Flashforge', 'ProtoDesign'];
const brandFromName = (name: string) => KNOWN_BRANDS.find((b) => name.trim().toLowerCase().startsWith(b.toLowerCase())) ?? null;

/** Specs collapse to this many until "Show all" is pressed. */
const SPECS_SHOWN = 12;

/**
 * Specs as tiles divided by hairlines: label above, value below. Each tile
 * draws its own right and bottom rule; the frame hides the outer ones, so an
 * odd count leaves plain card, not a grey gap.
 */
const SpecTiles = ({ specs, wide = false }: { specs: { key: string; value: string }[]; wide?: boolean }) => (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
        <dl className={`-mb-px -mr-px grid grid-cols-2 ${wide ? 'sm:grid-cols-3 lg:grid-cols-4' : ''}`}>
            {specs.map(({ key, value }) => (
                <div key={key} className="border-b border-r border-border/60 px-4 py-3.5">
                    <dt className="text-xs text-muted-foreground">{key}</dt>
                    <dd className="mt-1 text-sm font-semibold leading-snug text-foreground">{value}</dd>
                </div>
            ))}
        </dl>
    </div>
);

// --- MAIN PAGE ---
const ProductDetail = () => {
    const { productId } = useParams<{ productId: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const { addToCart } = useCart();

    const [product, setProduct] = useState<Product | null>(null);
    const [relatedProducts, setRelatedProducts] = useState<Product[]>([]);
    const [reviews, setReviews] = useState<Review[]>([]);

    const [loading, setLoading] = useState(true);
    const [quantity, setQuantity] = useState(1);
    const [activeImage, setActiveImage] = useState<string>("");

    const [isAdmin, setIsAdmin] = useState(false);
    const [deletingReviewId, setDeletingReviewId] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    const [editState, setEditState] = useState<EditableProductState | null>(null);
    const [history, setHistory] = useState<EditableProductState[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [isSaving, setIsSaving] = useState(false);

    const [isReviewFormOpen, setIsReviewFormOpen] = useState(false);
    const [newReview, setNewReview] = useState({ rating: 0, comment: '' });
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [reviewFilter, setReviewFilter] = useState("recent");
    const [reviewPage, setReviewPage] = useState(1);
    const REVIEWS_PER_PAGE = 6;

    const [isAddingToCart, setIsAddingToCart] = useState(false);

    const normalizeSpecs = useCallback((specs: any): Array<{ key: string, value: string }> => {
        if (!specs) return [];
        if (Array.isArray(specs)) return specs;
        return Object.entries(specs).map(([key, value]) => ({ key, value: String(value) }));
    }, []);

    useEffect(() => {
        const checkAdmin = async () => {
            try {
                if (apiService.isAuthenticated()) {
                    const user = await apiService.getCurrentUser();
                    if (user.role === 'admin' || user.user?.role === 'admin') {
                        setIsAdmin(true);
                        return true;
                    }
                }
            } catch (e) {
                console.error("Auth check failed", e);
            }
            return false;
        };

        const loadData = async () => {
            try {
                if (!productId) { navigate("/shop"); return; }
                setLoading(true);

                const admin = await checkAdmin();

                const productRes = await apiService.getProduct(productId);
                const fetchedProduct = productRes.data || productRes;
                setProduct(fetchedProduct);
                // The team's own browsing is not demand.
                if (!admin) track('product_view', { productId: fetchedProduct.id });

                const firstImg = fetchedProduct.product_images?.[0]?.image_url
                    || fetchedProduct.product_images?.[0]?.image_data
                    || fetchedProduct.image_url
                    || "/placeholder.svg";
                setActiveImage(firstImg);

                try {
                    const reviewRes = await apiService.getProductReviews(fetchedProduct.id);
                    const reviewsData = Array.isArray(reviewRes) ? reviewRes : (reviewRes.data || []);
                    setReviews(reviewsData);
                } catch (e) { console.error("Failed to load reviews"); }

                // Its own try: a failed "You may also like" must not send the visitor away from the product.
                if (fetchedProduct.category) {
                    try {
                        const categoryRes = await apiService.getProducts(fetchedProduct.category);
                        // GET /products returns a bare array (as ProductCatalog reads it); .data alone left this always empty.
                        const list: Product[] = Array.isArray(categoryRes) ? categoryRes : (categoryRes.data || []);
                        setRelatedProducts(list.filter((p: Product) => p.id !== fetchedProduct.id).slice(0, 10));
                    } catch (e) { console.error("Failed to load related products", e); }
                }

                window.scrollTo(0, 0);

            } catch (error) {
                console.error("Error loading product", error);
                navigate("/shop");
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, [productId, navigate]);

    useEffect(() => {
        if (product && isAdmin && searchParams.get('edit') === 'true' && !isEditing) {
            startEditing();
        }
    }, [product, isAdmin, searchParams]);

    const startEditing = () => {
        if (!product) return;

        // ✅ Parse specifications and extract the COD override flag
        const rawSpecs = normalizeSpecs(product.specifications);
        const hasOverride = rawSpecs.some(s => s.key === 'allow_cod_override' && String(s.value).toLowerCase() === 'true');
        const cleanSpecs = rawSpecs.filter(s => s.key !== 'allow_cod_override').map((item) => ({
            id: Math.random().toString(36).substr(2, 9),
            key: item.key,
            value: item.value
        }));

        const initialState: EditableProductState = {
            name: product.name,
            description: product.description,
            short_description: product.short_description || '',
            // The stored price: during a festival sale product.price is discounted,
            // and saving that back would make the discount permanent.
            price: Number(product.list_price ?? product.price),
            stock: product.stock,
            category: product.category,
            sub_category: product.sub_category || '',
            specificationsArray: cleanSpecs,
            currentImages: product.product_images || [],
            deletedImageIds: [],
            newImageFiles: [],
            newImagePreviews: [],
            videoFile: null,
            videoPreview: null,
            deleteVideo: false,
            allowCodOverride: hasOverride // ✅ Initialize State
        };

        setEditState(initialState);
        setHistory([initialState]);
        setHistoryIndex(0);
        setIsEditing(true);
    };

    const updateEditState = useCallback((newState: Partial<EditableProductState>) => {
        setEditState((prev) => {
            if (!prev) return null;
            const updated = { ...prev, ...newState };
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push(updated);
            setHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
            return updated;
        });
    }, [history, historyIndex]);

    const handleUndo = () => {
        if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
            setEditState(history[historyIndex - 1]);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
            setEditState(history[historyIndex + 1]);
        }
    };

    const cancelEditing = async () => {
        if (editState) {
            editState.newImagePreviews.forEach(url => URL.revokeObjectURL(url));
            if (editState.videoPreview) URL.revokeObjectURL(editState.videoPreview);
        }

        if (searchParams.get('new') === 'true' && product) {
            try {
                await apiService.deleteProduct(product.id, true);
                toast.info("Draft discarded");
                navigate(-1);
                return;
            } catch (e) {
                console.error("Failed to delete draft", e);
            }
        }

        setIsEditing(false);
        setEditState(null);
        setHistory([]);
        setSearchParams({}, { replace: true });
    };

    const saveChanges = async () => {
        if (!product || !editState) return;
        setIsSaving(true);
        try {
            const specsToSave = editState.specificationsArray.map(({ key, value }) => ({ key, value }));
            
            // ✅ Inject COD Override back into specifications before saving
            if (editState.allowCodOverride) {
                specsToSave.push({ key: 'allow_cod_override', value: 'true' });
            }

            // Media goes browser -> Cloudinary; the API receives URLs only, which
            // keeps the request under Lambda's 6MB payload limit.
            const images = await Promise.all(
                editState.newImageFiles.map(file => apiService.uploadProductMedia(file, 'image'))
            );
            const videoUrl = editState.videoFile
                ? await apiService.uploadProductMedia(editState.videoFile, 'video')
                : null;

            await apiService.updateProduct(product.id, {
                name: editState.name,
                description: editState.description,
                short_description: editState.short_description,
                price: editState.price,
                stock: editState.stock,
                category: editState.category,
                sub_category: editState.sub_category,
                specifications: JSON.stringify(specsToSave),
                is_archived: false,
                images,
                videoUrl,
                imagesToDelete: editState.deletedImageIds,
                deleteVideo: editState.deleteVideo && !editState.videoFile,
            });
            toast.success("Product published successfully!");
            setSearchParams({});
            window.location.reload();
        } catch (error: any) {
            toast.error(error.message || "Failed to update product");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSpecChange = (id: string, field: 'key' | 'value', text: string) => {
        if (!editState) return;
        const newArray = editState.specificationsArray.map(item =>
            item.id === id ? { ...item, [field]: text } : item
        );
        updateEditState({ specificationsArray: newArray });
    };

    const handleAddSpec = () => {
        if (!editState) return;
        const newSpec: EditableSpec = {
            id: Math.random().toString(36).substr(2, 9),
            key: "",
            value: ""
        };
        updateEditState({ specificationsArray: [...editState.specificationsArray, newSpec] });
    };

    const handleRemoveSpec = (id: string) => {
        if (!editState) return;
        const newArray = editState.specificationsArray.filter(item => item.id !== id);
        updateEditState({ specificationsArray: newArray });
    };

    const handleImageUpload = (files: File[]) => {
        if (!files || !files.length || !editState) return;
        const previews = files.map(f => URL.createObjectURL(f));
        updateEditState({
            newImageFiles: [...editState.newImageFiles, ...files],
            newImagePreviews: [...editState.newImagePreviews, ...previews]
        });
    };

    const DetailImageDropzone = () => {
        const { getRootProps, getInputProps, isDragActive } = useDropzone({
            onDrop: handleImageUpload,
            accept: { 'image/*': [] }
        });

        return (
            <div
                {...getRootProps()}
                className={`w-16 h-16 rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer hover:bg-primary/5 transition-colors ${
                    isDragActive ? 'border-primary bg-primary/10' : 'border-primary/50'
                }`}
            >
                <input {...getInputProps()} />
                <ImagePlus size={20} className={isDragActive ? "text-primary animate-bounce" : "text-primary"} />
            </div>
        );
    };

    const handleDeleteExistingImage = (imageId: string) => {
        if (!editState) return;
        updateEditState({
            currentImages: editState.currentImages.filter(img => img.id !== imageId),
            deletedImageIds: [...editState.deletedImageIds, imageId]
        });
    };

    const handleDeleteNewImage = (index: number) => {
        if (!editState) return;
        const newFiles = [...editState.newImageFiles];
        const newPreviews = [...editState.newImagePreviews];
        URL.revokeObjectURL(newPreviews[index]);
        newFiles.splice(index, 1);
        newPreviews.splice(index, 1);
        updateEditState({
            newImageFiles: newFiles,
            newImagePreviews: newPreviews
        });
    };

    const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.[0] || !editState) return;
        const file = e.target.files[0];
        const previewUrl = URL.createObjectURL(file);
        updateEditState({
            videoFile: file,
            videoPreview: previewUrl,
            deleteVideo: false
        });
    };

    const handleRemoveVideo = () => {
        if (!editState) return;
        updateEditState({
            deleteVideo: true,
            videoFile: null,
            videoPreview: null
        });
    };

    const handleRestoreVideo = () => {
        if (!editState) return;
        updateEditState({
            deleteVideo: false,
            videoFile: null,
            videoPreview: null
        });
    };

    const getProductImages = (): string[] => {
        if (isEditing && editState) {
            const existing = editState.currentImages.map(img => img.image_url || img.image_data || '').filter(Boolean);
            return [...existing, ...editState.newImagePreviews];
        }
        if (!product) return [];
        const images: string[] = [];
        if (product.video_url) images.push(product.video_url);
        if (product.product_images?.length) {
            product.product_images.forEach(img => {
                const url = img.image_url || img.image_data;
                if (url) images.push(url);
            });
        }
        if (images.length === 0 && product.image_url) images.push(product.image_url);
        return images;
    };

    const isVideo = (url: string) => url.includes('.mp4') || url.includes('.webm') || url.includes('video') || url.startsWith('blob:');

    const handleAddToCart = async () => {
        if (!product) return;
        try {
            if (!apiService.isAuthenticated()) {
                toast.error("Please sign in to add items");
                navigate("/auth");
                return;
            }
            setIsAddingToCart(true);
            await addToCart(product.id, quantity);
            toast.success("Added to cart!");
            navigate("/cart");
        } catch { toast.error("Failed to add to cart"); }
        finally { setIsAddingToCart(false); }
    };

    const handleSubmitReview = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!product) return;
        if (!apiService.isAuthenticated()) { toast.error("Please sign in to review"); navigate("/auth"); return; }
        if (newReview.rating === 0) return toast.error("Please select a star rating");

        setIsSubmitting(true);
        try {
            await apiService.addProductReview(product.id, newReview.rating, newReview.comment);
            toast.success("Review posted!");
            const reviewRes = await apiService.getProductReviews(product.id);
            const reviewsData = Array.isArray(reviewRes) ? reviewRes : (reviewRes.data || []);
            setReviews(reviewsData);
            setNewReview({ rating: 0, comment: '' });
            setIsReviewFormOpen(false);
        } catch (error: any) {
            toast.error(error.message || "Failed to post review");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteReview = async (review: Review) => {
        if (!product) return;
        if (!window.confirm(`Delete ${review.user}'s review? This cannot be undone.`)) return;

        setDeletingReviewId(review.id);
        try {
            await apiService.deleteProductReview(product.id, review.id);
            const remaining = reviews.filter(r => r.id !== review.id);
            setReviews(remaining);
            setReviewPage(page => Math.min(page, Math.max(1, Math.ceil(remaining.length / REVIEWS_PER_PAGE))));
            toast.success("Review deleted");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to delete review");
        } finally {
            setDeletingReviewId(null);
        }
    };

    const handleExploreCategory = () => {
        if (!product) return;
        const route = CATEGORY_ROUTES[product.category] || `/shop?category=${product.category}`;
        navigate(route);
    };

    // --- SEO: shared with scripts/prerender.mjs so crawler and browser see the same tags ---
    const allImages = getProductImages();
    const toAbsolute = (url: string) => (url.startsWith('http') ? url : `${SITE_URL}${url}`);
    const productImages = allImages.map(toAbsolute);
    const [categoryName, categoryPath] = CATEGORY_PAGES[product?.category ?? ''] ?? ['Shop', '/shop'];

    // Phones: once the Add to cart row scrolls away, a slim bar keeps it in reach.
    const reduceMotion = useReducedMotion();
    const [showAllSpecs, setShowAllSpecs] = useState(false);
    // A callback ref: the row only exists once the product has loaded. React
    // skips the re-render while the answer stays the same.
    const [ctaRow, ctaRef] = useState<HTMLDivElement | null>(null);
    const [ctaPassed, setCtaPassed] = useState(false);
    const { scrollY } = useScroll();
    useMotionValueEvent(scrollY, 'change', () => {
        if (ctaRow) setCtaPassed(ctaRow.getBoundingClientRect().bottom < 0);
    });

    if (loading) return <div className="min-h-screen pt-32 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
    if (!product) return null;

    const inStock = isEditing ? (editState?.stock ?? 0) > 0 : product.stock > 0;

    // The system share sheet where there is one (phones), else copy the link.
    const shareProduct = async () => {
        const url = productUrl(product);
        try {
            if (navigator.share) {
                await navigator.share({ title: product.name, url });
                return;
            }
            await navigator.clipboard.writeText(url);
            toast.success('Link copied');
        } catch (error) {
            if ((error as Error)?.name === 'AbortError') return; // the shopper closed the share sheet
            console.error('Share failed', error);
            toast.error('Could not share this link. Copy it from the address bar.');
        }
    };
    const madeToOrder = isMadeToOrder(product);
    // Derived from the loaded reviews so it stays in step with the count after a post or delete.
    const averageRating = reviews.length ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length : 0;
    const displaySpecs = normalizeSpecs(product.specifications).filter(s => s.key !== 'allow_cod_override');
    const brand = displaySpecs.find((s) => s.key.trim().toLowerCase() === 'brand')?.value ?? brandFromName(product.name);
    const tileSpecs = displaySpecs.filter((s) => s.key.trim().toLowerCase() !== 'brand');
    const specsInBuyBox = tileSpecs.length <= GLANCE_SPECS;
    const glanceSpecs = specsInBuyBox ? tileSpecs : [...tileSpecs.filter((s) => KEY_SPEC_RE.test(s.key)), ...tileSpecs.filter((s) => !KEY_SPEC_RE.test(s.key))].slice(0, 4);
    const was = dealPrice(product);

    return (
        <>
            <Seo
                title={productTitle(product.name, categoryName, product)}
                description={productDescription(product)}
                canonicalPath={new URL(productUrl(product)).pathname}
                image={productImages[0]}
                type="product"
                jsonLd={productLd({ ...product, images: productImages }, categoryName, categoryPath)}
            />
        <div className="min-h-screen bg-background pt-24 pb-16 font-sans relative">

            {isAdmin && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground/90 text-background backdrop-blur-md px-6 py-3 rounded-full shadow-2xl border border-background/20 flex items-center gap-4 transition-all">
                    {!isEditing ? (
                        <Button onClick={startEditing} variant="secondary" className="rounded-full gap-2 font-bold shadow-lg">
                            <PenLine size={16} /> Edit Page
                        </Button>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Button size="icon" variant="ghost" className="text-background hover:bg-background/20 hover:text-background rounded-full" onClick={handleUndo} disabled={historyIndex <= 0}>
                                <Undo size={18} />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-background hover:bg-background/20 hover:text-background rounded-full" onClick={handleRedo} disabled={historyIndex >= history.length - 1}>
                                <Redo size={18} />
                            </Button>
                            <div className="w-px h-6 bg-background/20 mx-2" />
                            <Button variant="destructive" size="sm" onClick={cancelEditing} className="rounded-full">
                                <X size={16} className="mr-1" /> Cancel
                            </Button>
                            <Button variant="default" size="sm" onClick={saveChanges} disabled={isSaving} className="rounded-full bg-green-500 hover:bg-green-600 text-white border-0">
                                {isSaving ? <Loader2 className="animate-spin mr-1 w-4 h-4"/> : <Save size={16} className="mr-1" />} Save
                            </Button>
                        </div>
                    )}
                </div>
            )}

            <div className="container mx-auto max-w-[1320px] px-4 sm:px-6 lg:px-8">
                <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-muted-foreground mb-6 lg:mb-8 min-w-0">
                    <Link to="/" className="hover:text-foreground transition-colors shrink-0">Home</Link>
                    <ChevronRight size={14} className="shrink-0 opacity-60" />
                    <Link to={categoryPath} className="hover:text-foreground transition-colors shrink-0">{categoryName}</Link>
                    <ChevronRight size={14} className="shrink-0 opacity-60" />
                    <span className="text-foreground/80 truncate">
                        {isEditing ? <span className="italic text-primary">Editing...</span> : product.name}
                    </span>
                </nav>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 xl:gap-16 mb-20 lg:mb-28">
                    <div className={`lg:col-span-7 lg:sticky lg:top-28 self-start ${isEditing ? 'space-y-6' : 'lg:grid lg:grid-cols-[72px_minmax(0,1fr)] lg:gap-4'}`}>
                        <div className={`aspect-square w-full rounded-3xl ${STAGE} relative overflow-hidden`}>
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.div
                                    key={activeImage || allImages[0]}
                                    className="absolute inset-0"
                                    initial={reduceMotion ? false : { opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={reduceMotion ? undefined : { opacity: 0 }}
                                    transition={{ duration: 0.18 }}
                                >
                                    {activeImage && isVideo(activeImage) ? (
                                        <video src={activeImage} controls autoPlay muted loop className="w-full h-full object-contain bg-black" />
                                    ) : (
                                        <ImageMagnifier src={activeImage || allImages[0]} alt={product.name} />
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </div>

                        <div className={isEditing ? 'flex gap-3 justify-center flex-wrap' : 'mt-3 -mx-1 flex gap-3 overflow-x-auto p-1 lg:order-first lg:mx-0 lg:mt-0 lg:flex-col lg:overflow-visible lg:p-0'}>
                            {isEditing && editState ? (
                                <>
                                    <div className="w-full mb-2 p-3 bg-muted/30 rounded-lg border border-dashed flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                                                <Video size={20} />
                                            </div>
                                            <div className="text-sm">
                                                {editState.videoPreview ? (
                                                    <span className="font-medium text-green-300">New video selected</span>
                                                ) : editState.deleteVideo ? (
                                                    <span className="font-medium text-red-500 line-through">Video deleted</span>
                                                ) : product.video_url ? (
                                                    <span className="font-medium">Current Video</span>
                                                ) : (
                                                    <span className="text-muted-foreground">No video</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {editState.deleteVideo && (
                                                <Button size="sm" variant="outline" onClick={handleRestoreVideo} className="h-8">
                                                    <RefreshCcw size={14} className="mr-1"/> Restore
                                                </Button>
                                            )}
                                            {!editState.deleteVideo && (product.video_url || editState.videoFile) && (
                                                <Button size="icon" variant="ghost" onClick={handleRemoveVideo} className="h-8 w-8 text-red-500 hover:bg-red-500/20">
                                                    <Trash2 size={16} />
                                                </Button>
                                            )}
                                            <label className="cursor-pointer">
                                                <div className="h-8 px-3 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-xs font-medium flex items-center">
                                                    {editState.videoFile ? "Replace" : "Upload"}
                                                </div>
                                                <input type="file" accept="video/*" className="hidden" onChange={handleVideoUpload} />
                                            </label>
                                        </div>
                                    </div>

                                    {editState.currentImages.map((img) => (
                                        <div key={img.id} className="relative group w-16 h-16 rounded-lg border overflow-hidden">
                                            <img src={img.image_url || img.image_data} alt={product.name} className="w-full h-full object-contain" />
                                            <button onClick={() => handleDeleteExistingImage(img.id)} className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                                <Trash2 size={20} />
                                            </button>
                                        </div>
                                    ))}
                                    {editState.newImagePreviews.map((url, idx) => (
                                        <div key={`new-${idx}`} className="relative group w-16 h-16 rounded-lg border overflow-hidden border-green-500">
                                            <img src={url} alt={`${product.name} new view ${idx}`} className="w-full h-full object-contain" />
                                            <button onClick={() => handleDeleteNewImage(idx)} className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition-opacity">
                                                <Trash2 size={20} />
                                            </button>
                                        </div>
                                    ))}
                                    <DetailImageDropzone />
                                </>
                            ) : (
                                allImages.map((img, idx) => (
                                    <button
                                        key={idx}
                                        type="button"
                                        onClick={() => setActiveImage(img)}
                                        aria-label={`Show ${isVideo(img) ? 'video' : `photo ${idx + 1}`}`}
                                        aria-pressed={(activeImage || allImages[0]) === img}
                                        className={`h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl ${STAGE} transition
                                            ${(activeImage || allImages[0]) === img ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'opacity-70 hover:opacity-100'}`}
                                    >
                                        {isVideo(img) ? (
                                            <span className="flex h-full w-full items-center justify-center bg-neutral-900">
                                                <Play size={20} className="text-white" />
                                            </span>
                                        ) : (
                                            <img src={img} className="h-full w-full object-contain p-1.5 mix-blend-multiply" alt="" />
                                        )}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="lg:col-span-5 flex flex-col">
                        <div className="mb-3 flex flex-wrap items-center gap-3">
                            {isEditing && editState ? (
                                <>
                                    <Select value={editState.category} onValueChange={(val) => updateEditState({ category: val })}>
                                        <SelectTrigger className="w-[140px] h-9 text-xs font-bold uppercase"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="3d_printer">3D Printer</SelectItem>
                                            <SelectItem value="filament">Filament</SelectItem>
                                            <SelectItem value="resin">Resin</SelectItem>
                                            <SelectItem value="accessory">Accessory</SelectItem>
                                            <SelectItem value="spare_part">Spare Part</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Input
                                        value={editState.sub_category}
                                        onChange={(e) => updateEditState({ sub_category: e.target.value })}
                                        className="w-[140px] h-9 text-xs font-semibold uppercase"
                                        placeholder="Sub Category"
                                    />
                                    
                                    {/* ✅ MASTER COD OVERRIDE EXPLICIT DROPDOWN */}
                                    <div className="flex items-center gap-2 bg-muted/30 p-1 rounded-md border border-dashed ml-auto">
                                        <Label className="text-xs font-bold whitespace-nowrap pl-2">COD Override:</Label>
                                        <Select 
                                            value={editState.allowCodOverride ? "true" : "false"} 
                                            onValueChange={val => updateEditState({ allowCodOverride: val === "true" })}
                                        >
                                            <SelectTrigger className={`w-[150px] h-8 text-xs font-bold ${editState.allowCodOverride ? "border-green-500 bg-green-500/15 text-green-300" : ""}`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="false">Standard Rules</SelectItem>
                                                <SelectItem value="true" className="text-green-300 font-bold">Force Enable COD</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </>
                            ) : (
                                <p className="text-sm">
                                    {brand && <span className="font-semibold text-primary">{brand}</span>}
                                    {brand && <span className="mx-2 text-muted-foreground/60" aria-hidden="true">/</span>}
                                    <Link to={categoryPath} className="text-muted-foreground hover:text-foreground">
                                        {[CATEGORY_LABELS[product.category] ?? 'Product', product.sub_category].filter(Boolean).join(', ')}
                                    </Link>
                                </p>
                            )}
                        </div>

                        {isEditing && editState ? (
                            <Input
                                value={editState.name}
                                onChange={(e) => updateEditState({ name: e.target.value })}
                                className="text-4xl font-extrabold mb-4 h-auto py-2 border-dashed border-2 border-primary/30 bg-primary/5"
                            />
                        ) : (
                            <h1 className="font-display text-3xl sm:text-4xl xl:text-[2.75rem] font-bold tracking-tight leading-[1.08] text-foreground text-balance">{product.name}</h1>
                        )}

                        {isEditing && editState && (
                            <Textarea
                                value={editState.short_description}
                                onChange={(e) => updateEditState({ short_description: e.target.value })}
                                className="mb-4 text-muted-foreground border-dashed border-primary/30"
                                placeholder="Short description..."
                            />
                        )}

                        {/* A 0.0 rating reads as "nobody buys this"; show nothing until there is a review. */}
                        {!isEditing && product.short_description && (
                            <p className="mt-4 max-w-[60ch] text-base leading-relaxed text-muted-foreground line-clamp-3">{product.short_description}</p>
                        )}

                        {reviews.length > 0 && (
                            <a href="#reviews" className="mt-4 inline-flex items-center gap-2 self-start text-sm">
                                <StarRating rating={averageRating} size={16} />
                                <span className="font-semibold text-foreground">{averageRating.toFixed(1)}</span>
                                <span className="text-muted-foreground underline-offset-4 hover:underline">{reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</span>
                            </a>
                        )}

                        <div className="mt-8 border-t border-border/60 pt-6 mb-8">
                            {isEditing && editState ? (
                                <div className="flex gap-4 items-center">
                                    <div className="flex items-center gap-2">
                                        <span className="text-2xl font-bold">₹</span>
                                        <Input
                                            type="number"
                                            value={editState.price}
                                            onChange={(e) => updateEditState({ price: Number(e.target.value) })}
                                            className="text-3xl font-bold w-40 border-dashed border-primary/30"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">Stock:</span>
                                        <Input
                                            type="number"
                                            value={editState.stock}
                                            onChange={(e) => updateEditState({ stock: Number(e.target.value) })}
                                            className="w-24 border-dashed border-primary/30"
                                        />
                                    </div>
                                </div>
                            ) : (
                                <>
                                    {was !== null && inStock && (
                                        <span className="mb-3 inline-block rounded-full bg-[hsl(var(--festive-on-dark))] px-3 py-1 text-xs font-semibold text-neutral-950">{dealBadge(product, was)}</span>
                                    )}
                                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                        <p className="font-display text-4xl sm:text-5xl font-bold tracking-tight tabular-nums text-foreground">
                                            {was !== null && inStock && <span className="sr-only">Now </span>}{formatINR(product.price)}
                                        </p>
                                        {was !== null && inStock && (
                                            <p className="text-lg tabular-nums text-muted-foreground">
                                                {product.festival ? <span className="sr-only">Was </span> : 'M.R.P. '}<s>{formatINR(was)}</s>
                                            </p>
                                        )}
                                    </div>
                                    {was !== null && inStock && (
                                        <p className="mt-2 text-sm font-semibold text-primary tabular-nums">You save {formatINR(was - Number(product.price))}</p>
                                    )}
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        Inclusive of GST{product.category === '3d_printer' ? ', with free shipping across India' : ''}
                                    </p>
                                    {inStock && <FestivalPriceNote product={product} />}
                                    {inStock && <FreeGiftNote product={product} className="mt-2" />}
                                    <p className={`mt-3 text-sm font-medium flex items-center gap-2 ${inStock ? 'text-green-300' : 'text-red-300'}`}>
                                        {inStock ? <Check className="w-4 h-4"/> : null}
                                        {!inStock ? 'Out of Stock' : madeToOrder ? 'Made to order: printed after you order' : `${product.stock} In Stock & Ready to Ship`}
                                    </p>
                                </>
                            )}
                        </div>

                        <div ref={ctaRef} className={`flex gap-3 mb-8 ${isEditing ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="flex h-12 shrink-0 items-center rounded-full border border-border bg-background">
                                <button type="button" onClick={() => setQuantity(q => Math.max(1, q - 1))} aria-label="One fewer" className="flex h-full w-11 items-center justify-center rounded-l-full hover:bg-accent/40 active:scale-95"><Minus size={16}/></button>
                                <span className="w-8 text-center font-semibold tabular-nums" aria-live="polite">{quantity}</span>
                                <button type="button" onClick={() => setQuantity(q => Math.min(product.stock, q + 1))} aria-label="One more" className="flex h-full w-11 items-center justify-center rounded-r-full hover:bg-accent/40 active:scale-95"><Plus size={16}/></button>
                            </div>
                            <Button onClick={handleAddToCart} disabled={!inStock || isAddingToCart} className="h-12 flex-1 rounded-full text-base font-semibold active:scale-[0.98] transition-transform">
                                {isAddingToCart ? <Loader2 className="animate-spin mr-2"/> : <ShoppingCart className="mr-2 h-5 w-5"/>}
                                {isAddingToCart ? 'Adding...' : 'Add to cart'}
                            </Button>
                            <Button variant="outline" className="h-12 w-12 shrink-0 rounded-full p-0" onClick={shareProduct} aria-label="Share this product"><Share2 className="w-5 h-5"/></Button>
                        </div>

                        <div className="mb-8">
                            <div className="flex justify-between items-center mb-3">
                                <h2 className="text-sm font-semibold text-foreground">{specsInBuyBox || isEditing ? 'Specifications' : 'At a glance'}</h2>
                                {isEditing && (
                                    <Button size="sm" variant="outline" onClick={handleAddSpec} className="h-7 text-xs">
                                        <Plus size={12} className="mr-1"/> Add Spec
                                    </Button>
                                )}
                            </div>

                            <div className={isEditing ? 'rounded-lg overflow-hidden border border-border/50' : ''}>
                                {isEditing && editState ? (
                                    <Reorder.Group
                                        axis="y"
                                        values={editState.specificationsArray}
                                        onReorder={(newOrder) => updateEditState({ specificationsArray: newOrder })}
                                        className="bg-background"
                                    >
                                        {editState.specificationsArray.map((item) => (
                                            <Reorder.Item
                                                key={item.id}
                                                value={item}
                                                className="flex border-b last:border-0 border-border/50 bg-background"
                                            >
                                                <div className="p-2 flex items-center justify-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                                                    <GripVertical size={16} />
                                                </div>
                                                <div className="p-2 w-1/3 border-r border-dashed border-border/50">
                                                    <Input
                                                        value={item.key}
                                                        onChange={(e) => handleSpecChange(item.id, 'key', e.target.value)}
                                                        className="h-8 font-medium text-muted-foreground border-none bg-transparent focus-visible:ring-0 px-0"
                                                        placeholder="Key"
                                                    />
                                                </div>
                                                <div className="p-2 flex-1 flex items-center gap-2">
                                                    <Input
                                                        value={item.value}
                                                        onChange={(e) => handleSpecChange(item.id, 'value', e.target.value)}
                                                        className="h-8 font-medium text-foreground border-none bg-transparent focus-visible:ring-0 px-0"
                                                        placeholder="Value"
                                                    />
                                                    <button onClick={() => handleRemoveSpec(item.id)} className="text-red-500 hover:bg-red-500/20 p-1 rounded shrink-0">
                                                        <X size={14}/>
                                                    </button>
                                                </div>
                                            </Reorder.Item>
                                        ))}
                                    </Reorder.Group>
                                ) : (
                                    <SpecTiles specs={glanceSpecs} />
                                )}
                            </div>
                        </div>

                        {!isEditing && INTEREST_FOR_CATEGORY[product.category] && (
                            <div className="mb-6"><ProductAlert productId={product.id} inStock={inStock} /></div>
                        )}

                        <ProductPromises product={product} />
                    </div>
                </div>

                {!isEditing && !specsInBuyBox && (
                    <section className="mb-20 lg:mb-28" aria-labelledby="specs-heading">
                        <h2 id="specs-heading" className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-6">Specifications</h2>
                        <SpecTiles specs={showAllSpecs ? tileSpecs : tileSpecs.slice(0, SPECS_SHOWN)} wide />
                        {tileSpecs.length > SPECS_SHOWN && (
                            <Button variant="outline" className="mt-4 rounded-full" onClick={() => setShowAllSpecs((v) => !v)} aria-expanded={showAllSpecs}>
                                {showAllSpecs ? 'Show fewer' : `Show all ${tileSpecs.length} specifications`}
                            </Button>
                        )}
                    </section>
                )}

                {!isEditing && INTEREST_FOR_CATEGORY[product.category] && (
                    <div className="mb-24">
                        <LeadCapture interest={INTEREST_FOR_CATEGORY[product.category]} form="product_page"
                            productId={product.id} productName={product.name} />
                    </div>
                )}

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 mb-24 items-start">
                    <div id="reviews" className="lg:col-span-5 lg:order-last scroll-mt-28">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">Reviews</h2>
                            <Select value={reviewFilter} onValueChange={setReviewFilter}>
                                <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Sort" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="recent">Newest</SelectItem>
                                    <SelectItem value="high">Highest Rated</SelectItem>
                                    <SelectItem value="low">Lowest Rated</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="mb-8">
                            {!isReviewFormOpen ? (
                                <button onClick={() => setIsReviewFormOpen(true)} className="flex items-center gap-2 text-primary font-medium hover:underline group">
                                    <PenLine size={18} /> Write a product review
                                </button>
                            ) : (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="bg-card border rounded-xl p-6 shadow-sm">
                                    <div className="flex justify-between items-center mb-4">
                                        <h3 className="font-bold">Write a Review</h3>
                                        <button onClick={() => setIsReviewFormOpen(false)} className="text-muted-foreground hover:text-foreground text-sm">Cancel</button>
                                    </div>
                                    <form onSubmit={handleSubmitReview} className="space-y-4">
                                        <div><label className="block text-sm font-medium mb-1">Rating</label><StarRating rating={newReview.rating} interactive onRate={r => setNewReview({...newReview, rating: r})} size={24} /></div>
                                        <div><label className="block text-sm font-medium mb-1">Comment</label><textarea className="w-full p-3 rounded-md border bg-background focus:ring-1 focus:ring-primary outline-none min-h-[100px]" placeholder="What did you like or dislike?" value={newReview.comment} onChange={e => setNewReview({...newReview, comment: e.target.value})} required /></div>
                                        <Button type="submit" disabled={isSubmitting} className="w-full">{isSubmitting ? 'Submitting...' : 'Submit Review'}</Button>
                                    </form>
                                </motion.div>
                            )}
                        </div>

                        <div className="space-y-6">
                            {reviews.length === 0 ? (
                                <div className="text-center py-10 bg-muted/20 rounded-xl border border-dashed"><p className="text-muted-foreground">No reviews yet.</p></div>
                            ) : (
                                reviews.slice((reviewPage - 1) * REVIEWS_PER_PAGE, reviewPage * REVIEWS_PER_PAGE).map(r => (
                                    <div key={r.id} className="border-b pb-6 last:border-0 last:pb-0">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <span className="font-bold text-sm block">{r.user}</span>
                                                <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                                                {r.verified_purchase && (
                                                    <span className="ml-2 inline-flex items-center gap-1 text-xs font-medium text-green-300 dark:text-green-400"><BadgeCheck size={12} /> Verified purchase</span>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <StarRating rating={r.rating} size={14} />
                                                {isAdmin && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteReview(r)}
                                                        disabled={deletingReviewId === r.id}
                                                        aria-label={`Delete review by ${r.user}`}
                                                        className="text-muted-foreground hover:text-destructive disabled:opacity-50 transition-colors"
                                                    >
                                                        {deletingReviewId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <p className="text-muted-foreground text-sm leading-relaxed">{r.comment}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="lg:col-span-7 h-fit">
                        <article className="max-w-[68ch] text-muted-foreground leading-relaxed">
                            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground mb-6">About this {product.category === '3d_printer' ? 'printer' : 'product'}</h2>
                            {isEditing && editState ? (
                                <Textarea
                                    value={editState.description}
                                    onChange={(e) => updateEditState({ description: e.target.value })}
                                    className="min-h-[400px] font-sans text-muted-foreground leading-relaxed border-dashed border-primary/30"
                                />
                            ) : (
                                <ul className="space-y-4 text-[15px]">
                                    {product.description.split('\n').filter(line => line.trim() !== '').map((line, i) => (
                                        <li key={i} className="flex gap-3 items-start">
                                            <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                                            <span>{line}</span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </article>
                    </div>
                </div>

                {relatedProducts.length > 0 && (
                    <div className="border-t border-border/60 pt-16">
                        <div className="flex justify-between items-center mb-8 gap-4">
                            <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight">You may also like</h2>
                            <Button variant="ghost" className="shrink-0 text-primary hover:text-primary/80" onClick={handleExploreCategory}>
                                See all {categoryName.toLowerCase()} <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </div>
                        <div className="flex overflow-x-auto gap-6 pb-8 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                            {relatedProducts.map((related) => {
                                const rating = related.average_rating ? Number(related.average_rating) : 0;
                                return (
                                    <motion.div key={related.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="min-w-[280px] w-[280px] snap-start">
                                        {/* A real link, so crawlers follow it from printer to printer. */}
                                        <Link to={`/product/${related.slug || related.id}`} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <Card className="cursor-pointer transition-colors h-full flex flex-col group border-border/60 hover:border-primary/40 overflow-hidden rounded-2xl">
                                            <div className={`aspect-square flex items-center justify-center relative overflow-hidden ${STAGE}`}>
                                                <img src={related.image_url || '/placeholder.svg'} alt={related.name} loading="lazy" className="w-full h-full object-contain p-5 mix-blend-multiply transition-transform duration-500 group-hover:scale-105" />
                                            </div>
                                            <CardContent className="p-4 flex-1 flex flex-col">
                                                <div className="flex justify-between items-start mb-2 gap-2">
                                                    <h3 className="font-bold text-sm line-clamp-1 flex-1 leading-snug" title={related.name}>{related.name}</h3>
                                                    {rating > 0 && (<div className="flex items-center gap-1 bg-yellow-500/15 px-1.5 py-0.5 rounded text-[10px] font-bold text-yellow-300 shrink-0"><Star size={10} className="fill-current" /> {rating.toFixed(1)}</div>)}
                                                </div>
                                                <p className="text-xs text-muted-foreground mb-4 line-clamp-2 min-h-[2.5em]">{related.short_description || related.description}</p>
                                                <div className="mt-auto flex items-center justify-between"><span className="font-bold text-lg text-primary">{formatINR(related.price)}</span><span aria-hidden className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-secondary-foreground shadow-sm"><ShoppingCart size={14} /></span></div>
                                            </CardContent>
                                        </Card>
                                        </Link>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {!isAdmin && inStock && (
                <div
                    aria-hidden={!ctaPassed}
                    className={`fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur-md transition-transform duration-300 lg:hidden ${ctaPassed ? 'translate-y-0' : 'translate-y-full'}`}
                    style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                >
                    <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs text-muted-foreground">{product.name}</p>
                            <p className="font-display text-lg font-bold tabular-nums">{formatINR(product.price)}</p>
                        </div>
                        <Button onClick={handleAddToCart} disabled={isAddingToCart} tabIndex={ctaPassed ? 0 : -1} className="h-11 shrink-0 rounded-full px-6 font-semibold active:scale-[0.98]">
                            {isAddingToCart ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Add to cart'}
                        </Button>
                    </div>
                </div>
            )}
        </div>
        </>
    );
};

export default ProductDetail;
