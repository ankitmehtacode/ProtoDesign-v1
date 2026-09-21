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
    Truck,
    ShieldCheck,
    Minus,
    Plus,
    Check,
    ChevronRight,
    Share2,
    PenLine,
    ArrowRight,
    Headset,
    MapPin,
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
    GripVertical
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { useCart } from "@/hooks/use-cart";
import { formatINR } from "@/lib/currency";
import { motion, AnimatePresence, Reorder } from "framer-motion";
import { useDropzone } from 'react-dropzone';
import { Helmet } from "react-helmet-async";

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
            ${star <= (hover || rating) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
                    onClick={() => interactive && onRate && onRate(star)}
                    onMouseEnter={() => interactive && setHover(star)}
                    onMouseLeave={() => interactive && setHover(0)}
                />
            ))}
        </div>
    );
};

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
            className="relative w-full h-full overflow-hidden bg-white rounded-2xl border border-border/50 cursor-crosshair flex items-center justify-center group"
            onMouseEnter={() => setShowZoom(true)}
            onMouseLeave={() => setShowZoom(false)}
            onMouseMove={handleMouseMove}
        >
            <img
                ref={imgRef}
                src={src}
                alt={alt}
                className={`w-full h-full object-contain p-4 transition-opacity duration-200 ${showZoom ? 'opacity-0' : 'opacity-100'}`}
            />
            {showZoom && (
                <div className="absolute inset-0 overflow-hidden bg-white pointer-events-none">
                    <img
                        src={src}
                        alt={`${alt} zoomed`}
                        className="absolute max-w-none"
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

                await checkAdmin();

                const productRes = await apiService.getProduct(productId);
                const fetchedProduct = productRes.data || productRes;
                setProduct(fetchedProduct);

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

                if (fetchedProduct.category) {
                    const categoryRes = await apiService.getProducts(fetchedProduct.category);
                    const catProducts = (categoryRes.data || []).filter((p: Product) => p.id !== fetchedProduct.id);
                    setRelatedProducts(catProducts.slice(0, 10));
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
            price: product.price,
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

            const formData = new FormData();
            formData.append('name', editState.name);
            formData.append('description', editState.description);
            formData.append('short_description', editState.short_description);
            formData.append('price', String(editState.price));
            formData.append('stock', String(editState.stock));
            formData.append('category', editState.category);
            formData.append('sub_category', editState.sub_category);
            formData.append('specifications', JSON.stringify(specsToSave));
            formData.append('is_archived', 'false');

            if (editState.deletedImageIds.length > 0) formData.append('imagesToDelete', JSON.stringify(editState.deletedImageIds));
            editState.newImageFiles.forEach(file => formData.append('images', file));
            if (editState.videoFile) formData.append('video', editState.videoFile);
            if (editState.deleteVideo && !editState.videoFile) formData.append('delete_video', 'true');

            await apiService.updateProduct(product.id, formData);
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

    const handleExploreCategory = () => {
        if (!product) return;
        const route = CATEGORY_ROUTES[product.category] || `/shop?category=${product.category}`;
        navigate(route);
    };

    // --- SEO & SCHEMA GENERATION ---
    const siteUrl = window.location.origin;
    
    const currentUrl = product?.slug 
        ? `${siteUrl}/product/${product.slug}` 
        : `${siteUrl}/product/${productId}`;
        
    const productImage = activeImage || product?.image_url || '/placeholder.svg';
    const fullImageUrl = productImage.startsWith('http') ? productImage : `${siteUrl}${productImage}`;

    const allImages = getProductImages();
    const schemaImages = allImages.length > 0 
        ? allImages.map(img => img.startsWith('http') ? img : `${siteUrl}${img}`) 
        : [fullImageUrl];

    const priceValidUntil = new Date();
    priceValidUntil.setFullYear(priceValidUntil.getFullYear() + 1);

    const productSchema = product ? {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": product.name,
        "image": schemaImages,
        "description": product.short_description || product.description.substring(0, 160),
        "sku": product.id,
        "mpn": product.id,
        "brand": {
            "@type": "Brand",
            "name": "ProtoDesign"
        },
        "offers": {
            "@type": "Offer",
            "url": currentUrl,
            "priceCurrency": "INR",
            "price": product.price,
            "priceValidUntil": priceValidUntil.toISOString().split('T')[0],
            "itemCondition": "https://schema.org/NewCondition",
            "availability": product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            "shippingDetails": {
                "@type": "OfferShippingDetails",
                "shippingRate": {
                    "@type": "MonetaryAmount",
                    "value": product.category === '3d_printer' ? 0 : 199,
                    "currency": "INR"
                },
                "shippingDestination": {
                    "@type": "DefinedRegion",
                    "addressCountry": "IN"
                }
            },
            "hasMerchantReturnPolicy": {
                "@type": "MerchantReturnPolicy",
                "applicableCountry": "IN",
                "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
                "merchantReturnDays": 7,
                "returnMethod": "https://schema.org/ReturnByMail"
            }
        },
        ...(reviews.length > 0 && {
            "aggregateRating": {
                "@type": "AggregateRating",
                "ratingValue": product.average_rating || 5,
                "reviewCount": product.review_count || reviews.length
            },
            "review": reviews.slice(0, 5).map(r => ({
                "@type": "Review",
                "reviewRating": { "@type": "Rating", "ratingValue": r.rating },
                "author": { "@type": "Person", "name": r.user },
                "datePublished": r.created_at ? new Date(r.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                "reviewBody": r.comment
            }))
        })
    } : null;

    if (loading) return <div className="min-h-screen pt-32 flex justify-center"><Loader2 className="animate-spin text-primary w-8 h-8" /></div>;
    if (!product) return null;

    const inStock = isEditing ? (editState?.stock ?? 0) > 0 : product.stock > 0;
    const averageRating = product.average_rating ? Number(product.average_rating) : 0;
    const displaySpecs = normalizeSpecs(product.specifications).filter(s => s.key !== 'allow_cod_override');

    return (
        <>
            {product && (
                <Helmet>
                    <title>{`${product.name} - Buy Online | ProtoDesign`}</title>
                    <meta name="description" content={`Buy ${product.name} at ProtoDesign. ${product.short_description || product.description.substring(0, 120)}`} />
                    <link rel="canonical" href={currentUrl} />

                    <meta property="og:title" content={`${product.name} | ProtoDesign`} />
                    <meta property="og:description" content={product.short_description || product.description.substring(0, 160)} />
                    <meta property="og:image" content={fullImageUrl} />
                    <meta property="og:url" content={currentUrl} />
                    <meta property="og:type" content="product" />
                    <meta property="product:price:amount" content={product.price.toString()} />
                    <meta property="product:price:currency" content="INR" />

                    <script type="application/ld+json">
                        {JSON.stringify(productSchema)}
                    </script>
                </Helmet>
            )}
        <div className="min-h-screen bg-background pt-24 pb-16 font-sans relative">

            {isAdmin && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground/90 text-background backdrop-blur-md px-6 py-3 rounded-full shadow-2xl border border-white/20 flex items-center gap-4 transition-all">
                    {!isEditing ? (
                        <Button onClick={startEditing} variant="secondary" className="rounded-full gap-2 font-bold shadow-lg">
                            <PenLine size={16} /> Edit Page
                        </Button>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 rounded-full" onClick={handleUndo} disabled={historyIndex <= 0}>
                                <Undo size={18} />
                            </Button>
                            <Button size="icon" variant="ghost" className="text-white hover:bg-white/20 rounded-full" onClick={handleRedo} disabled={historyIndex >= history.length - 1}>
                                <Redo size={18} />
                            </Button>
                            <div className="w-px h-6 bg-white/20 mx-2" />
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

            <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
                    <Link to="/" className="hover:text-primary transition-colors">Home</Link>
                    <ChevronRight size={14} />
                    <Link to="/shop" className="hover:text-primary transition-colors">Shop</Link>
                    <ChevronRight size={14} />
                    <span className="font-medium text-foreground truncate">
                        {isEditing ? <span className="italic text-primary">Editing...</span> : product.name}
                    </span>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 mb-24">
                    <div className="space-y-6 top-24 h-fit">
                        <div className="w-[85%] mx-auto aspect-[4/5] bg-white rounded-2xl shadow-sm border border-border/50 relative z-10 flex items-center justify-center overflow-hidden">
                            {activeImage && isVideo(activeImage) ? (
                                <video src={activeImage} controls autoPlay muted loop className="w-full h-full object-contain" />
                            ) : (
                                <ImageMagnifier src={activeImage || allImages[0]} alt={product.name} />
                            )}
                        </div>

                        <div className="flex gap-3 justify-center flex-wrap">
                            {isEditing && editState ? (
                                <>
                                    <div className="w-full mb-2 p-3 bg-muted/30 rounded-lg border border-dashed flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                                                <Video size={20} />
                                            </div>
                                            <div className="text-sm">
                                                {editState.videoPreview ? (
                                                    <span className="font-medium text-green-600">New video selected</span>
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
                                                <Button size="icon" variant="ghost" onClick={handleRemoveVideo} className="h-8 w-8 text-red-500 hover:bg-red-50">
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
                                        onClick={() => setActiveImage(img)}
                                        className={`w-16 h-16 rounded-lg border-2 overflow-hidden relative bg-white
                                            ${activeImage === img ? 'border-primary ring-2 ring-primary/20' : 'border-transparent'}`}
                                    >
                                        {isVideo(img) ? (
                                            <div className="w-full h-full flex items-center justify-center bg-black/10">
                                                <Play size={20} className="text-gray-800" />
                                            </div>
                                        ) : (
                                            <img src={img} className="w-full h-full object-contain" alt={`${product.name} gallery image ${idx}`} />
                                        )}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col pt-4">
                        <div className="mb-4 flex flex-wrap items-center gap-3">
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
                                            <SelectTrigger className={`w-[150px] h-8 text-xs font-bold ${editState.allowCodOverride ? "border-green-500 bg-green-100 text-green-800" : ""}`}>
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="false">Standard Rules</SelectItem>
                                                <SelectItem value="true" className="text-green-700 font-bold">Force Enable COD</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                                        {(product.category || 'Uncategorized').replace(/_/g, ' ')}
                                    </span>
                                    {product.sub_category && (
                                        <span className="bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
                                            {product.sub_category}
                                        </span>
                                    )}
                                </>
                            )}
                        </div>

                        {isEditing && editState ? (
                            <Input
                                value={editState.name}
                                onChange={(e) => updateEditState({ name: e.target.value })}
                                className="text-4xl font-extrabold mb-4 h-auto py-2 border-dashed border-2 border-primary/30 bg-primary/5"
                            />
                        ) : (
                            <h1 className="text-4xl font-extrabold text-foreground mb-4 leading-tight">{product.name}</h1>
                        )}

                        {isEditing && editState && (
                            <Textarea
                                value={editState.short_description}
                                onChange={(e) => updateEditState({ short_description: e.target.value })}
                                className="mb-4 text-muted-foreground border-dashed border-primary/30"
                                placeholder="Short description..."
                            />
                        )}

                        <div className="flex items-center gap-4 mb-8 pb-8 border-b">
                            <div className="flex items-center gap-2">
                                <StarRating rating={averageRating} size={20} />
                                <span className="text-base font-bold text-foreground">{averageRating.toFixed(1)}</span>
                            </div>
                            <span className="text-sm text-muted-foreground">{reviews.length} Reviews</span>
                        </div>

                        <div className="mb-8">
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
                                    <p className="text-5xl font-bold text-foreground">{formatINR(product.price)}</p>
                                    <p className={`mt-3 text-sm font-medium flex items-center gap-2 ${inStock ? 'text-green-600' : 'text-red-600'}`}>
                                        {inStock ? <Check className="w-4 h-4"/> : null}
                                        {inStock ? `${product.stock} In Stock & Ready to Ship` : 'Out of Stock'}
                                    </p>
                                </>
                            )}
                        </div>

                        <div className="mb-8">
                            <div className="flex justify-between items-center mb-3">
                                <h3 className="font-semibold">Key Specs</h3>
                                {isEditing && (
                                    <Button size="sm" variant="outline" onClick={handleAddSpec} className="h-7 text-xs">
                                        <Plus size={12} className="mr-1"/> Add Spec
                                    </Button>
                                )}
                            </div>

                            <div className="rounded-lg overflow-hidden border border-border/50">
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
                                                    <button onClick={() => handleRemoveSpec(item.id)} className="text-red-500 hover:bg-red-50 p-1 rounded shrink-0">
                                                        <X size={14}/>
                                                    </button>
                                                </div>
                                            </Reorder.Item>
                                        ))}
                                    </Reorder.Group>
                                ) : (
                                    <table className="w-full text-sm text-left">
                                        <tbody>
                                        {displaySpecs.map(({key, value}, idx) => (
                                            <tr key={idx} className="border-b last:border-0 border-border/50">
                                                <td className="p-3 font-medium text-muted-foreground w-1/3">{key}</td>
                                                <td className="p-3 font-medium text-foreground">{value}</td>
                                            </tr>
                                        ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>
                        </div>

                        <div className={`flex flex-col sm:flex-row gap-4 mb-8 mt-auto ${isEditing ? 'opacity-50 pointer-events-none' : ''}`}>
                            <div className="flex items-center border rounded-lg h-12 w-32 bg-background shadow-sm">
                                <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="px-3 h-full hover:bg-accent rounded-l-lg"><Minus size={16}/></button>
                                <span className="flex-1 text-center font-bold">{quantity}</span>
                                <button onClick={() => setQuantity(q => Math.min(product.stock, q + 1))} className="px-3 h-full hover:bg-accent rounded-r-lg"><Plus size={16}/></button>
                            </div>
                            <Button onClick={handleAddToCart} disabled={!inStock || isAddingToCart} className="flex-1 h-12 text-lg shadow-lg hover:-translate-y-0.5 transition-transform">
                                {isAddingToCart ? <Loader2 className="animate-spin mr-2"/> : <ShoppingCart className="mr-2"/>}
                                {isAddingToCart ? 'Adding...' : 'Add to Cart'}
                            </Button>
                            <Button variant="outline" className="h-12 w-12 p-0"><Share2 className="w-5 h-5"/></Button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground p-4 bg-secondary/10 rounded-xl border border-border/50">
                            <div className="flex items-center gap-2"><Truck className="w-5 h-5 text-primary"/> Free Shipping</div>
                            <div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-primary"/> 1 Year Warranty</div>
                            <div className="flex items-center gap-2"><Headset className="w-5 h-5 text-primary"/> 24/7 Support</div>
                            <div className="flex items-center gap-2"><MapPin className="w-5 h-5 text-primary"/> Live Tracking</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 mb-24 items-start">
                    <div>
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-2xl font-bold font-display">Customer Reviews</h2>
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
                                <div className="text-center py-10 bg-muted/20 rounded-xl border border-dashed"><p className="text-muted-foreground">No reviews yet. Be the first!</p></div>
                            ) : (
                                reviews.slice((reviewPage - 1) * REVIEWS_PER_PAGE, reviewPage * REVIEWS_PER_PAGE).map(r => (
                                    <div key={r.id} className="border-b pb-6 last:border-0 last:pb-0">
                                        <div className="flex justify-between items-start mb-2">
                                            <div><span className="font-bold text-sm block">{r.user}</span><span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span></div>
                                            <StarRating rating={r.rating} size={14} />
                                        </div>
                                        <p className="text-muted-foreground text-sm leading-relaxed">{r.comment}</p>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    <div className="h-fit">
                        <article className="prose prose-sm max-w-none text-muted-foreground leading-relaxed">
                            <h2 className="text-2xl font-bold font-display mb-6">About {product.name}</h2>
                            {isEditing && editState ? (
                                <Textarea
                                    value={editState.description}
                                    onChange={(e) => updateEditState({ description: e.target.value })}
                                    className="min-h-[400px] font-sans text-muted-foreground leading-relaxed border-dashed border-primary/30"
                                />
                            ) : (
                                <div className="prose prose-sm max-w-none text-muted-foreground leading-relaxed">
                                    <ul className="space-y-3 list-none pl-0 ">
                                        {product.description.split('\n').filter(line => line.trim() !== '').map((line, i) => (
                                            <li key={i} className="flex gap-3 items-start">
                                                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-primary shrink-0 block" />
                                                <span>{line}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </article>
                    </div>
                </div>

                {relatedProducts.length > 0 && (
                    <div className="border-t pt-16">
                        <div className="flex justify-between items-center mb-8">
                            <h2 className="text-3xl font-display font-bold">Related Products</h2>
                            <Button variant="ghost" className="text-primary hover:text-primary/80" onClick={handleExploreCategory}>
                                Explore Category <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </div>
                        <div className="flex overflow-x-auto gap-6 pb-8 snap-x snap-mandatory scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">
                            {relatedProducts.map((related) => {
                                const rating = related.average_rating ? Number(related.average_rating) : 0;
                                return (
                                    <motion.div key={related.id} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="min-w-[280px] w-[280px] snap-start">
                                        <Card onClick={() => navigate(`/product/${related.slug || related.id}`)} className="cursor-pointer hover:shadow-xl transition-all h-full flex flex-col group border-border/60 overflow-hidden rounded-xl">
                                            <div className="aspect-square bg-black flex items-center justify-center relative overflow-hidden">
                                                <img src={related.image_url || '/placeholder.svg'} alt={related.name} className="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105" />
                                            </div>
                                            <CardContent className="p-4 flex-1 flex flex-col">
                                                <div className="flex justify-between items-start mb-2 gap-2">
                                                    <h3 className="font-bold text-sm line-clamp-1 flex-1 leading-snug" title={related.name}>{related.name}</h3>
                                                    {rating > 0 && (<div className="flex items-center gap-1 bg-yellow-50 px-1.5 py-0.5 rounded text-[10px] font-bold text-yellow-700 shrink-0"><Star size={10} className="fill-current" /> {rating.toFixed(1)}</div>)}
                                                </div>
                                                <p className="text-xs text-muted-foreground mb-4 line-clamp-2 min-h-[2.5em]">{related.short_description || related.description}</p>
                                                <div className="mt-auto flex items-center justify-between"><span className="font-bold text-lg text-primary">{formatINR(related.price)}</span><Button size="icon" variant="secondary" className="h-8 w-8 rounded-full shadow-sm"><ShoppingCart size={14} /></Button></div>
                                            </CardContent>
                                        </Card>
                                    </motion.div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
        </>
    );
};

export default ProductDetail;
