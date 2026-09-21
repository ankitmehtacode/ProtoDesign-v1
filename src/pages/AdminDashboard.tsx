import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import {
    Loader2,
    Package,
    ShoppingCart,
    DollarSign,
    TrendingUp,
    Plus,
    AlertTriangle,
    Edit3,
    X,
    ChevronRight,
    Upload,
    Search,
    Calendar as CalendarIcon,
    Trash2,
    FileText,
    Eye,
    Layers,
    Maximize,
    ChevronLeft,
    Archive,
    RefreshCw,
    Star
} from 'lucide-react';
import { formatINR } from '@/lib/currency';
import { apiService } from '@/services/api.service';
import { useDropzone } from "react-dropzone";

// --- CONFIGURATION ---
const MAIN_CATEGORIES = [
    { value: '3d_printer', label: '3D Printer' },
    { value: '3dprintables', label: '3D Printable' },
    { value: 'filament', label: 'Filament' },
    { value: 'resin', label: 'Resin' },
    { value: 'accessory', label: 'Accessory' },
    { value: 'spare_part', label: 'Spare Part' },
];

const SUB_CATEGORIES: Record<string, string[]> = {
    '3d_printer': ['FDM', 'SLA', 'Metal', '3D Pen', 'Others'],
    'filament': ['ABS', 'PETG', 'PLA', 'Carbon Fiber', 'Nylon Fiber', 'Others'],
    'resin': ['Standard', 'Water-Washable', 'Tough', 'Others'],
};

const ORDERS_PER_PAGE = 10;
const QUOTES_PER_PAGE = 10;

// --- INTERFACES ---
interface Product {
    id: string;
    name: string;
    description: string;
    price: number;
    stock: number;
    image_url: string | null;
    category: string;
    specifications?: Record<string, string>;
    totalSales?: number;
    short_description?: string;
    sub_category?: string;
    video_url?: string | null;
    product_images?: Array<{ id: string; image_url?: string; image_data?: string; display_order: number; }>;
    is_archived?: boolean;
}

interface Quote {
    id: string;
    email: string;
    phone: string;
    file_url: string;
    file_name: string;
    specifications: any;
    status: string;
    estimated_price: number;
    admin_notes: string;
    created_at: string;
}

interface Order {
    id: string;
    total_amount: number;
    tax_amount?: number;
    shipping_amount?: number;
    status: string;
    created_at: string;
    total_quantity: number;
    user_id: string;
    items: any[];
    shipping_address?: any;
    user_email?: string;
    user_name?: string;
}

interface SpecItem { key: string; value: string; }

// --- STATUS COLORS ---
const STATUSCOLORS: Record<string, string> = {
    pending: 'bg-gray-500',
    pending_payment: 'bg-yellow-500',
    processing: 'bg-blue-500',
    shipped: 'bg-purple-500',
    delivered: 'bg-green-500',
    completed: 'bg-green-600',
    cancelled: 'bg-red-500',
};

const STATUSLABELS: Record<string, string> = {
    pending: 'Pending',
    pending_payment: 'Pending Payment',
    processing: 'Processing',
    shipped: 'Shipped',
    delivered: 'Delivered',
    completed: 'Completed',
    cancelled: 'Cancelled',
};

const STATUSOPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'pending_payment', label: 'Pending Payment' },
    { value: 'processing', label: 'Processing' },
    { value: 'shipped', label: 'Shipped' },
    { value: 'delivered', label: 'Delivered' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
];

// Form Types
interface ProductFormState {
    name: string;
    description: string;
    short_description: string;
    price: string;
    stock: string;
    category: string;
    sub_category: string;
    imageFiles: File[];
    videoFile: File | null;
    specs: SpecItem[];
    allow_cod_override: boolean; 
}

interface EditingProductImageState {
    id: string;
    url: string;
    isNew: boolean;
}

/**
 * Quote models are stored privately, so a download is a short-lived signed URL
 * fetched on demand rather than a public link held in the row.
 */
const openQuoteFile = async (quoteId: string) => {
    try {
        const url = await apiService.getQuoteDownloadUrl(quoteId);
        window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err: any) {
        toast.error(err?.message || 'Could not open that file.');
    }
};

export default function AdminDashboard() {
    const navigate = useNavigate();

    // -- Global State --
    const [isAdmin, setIsAdmin] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    // -- Data State --
    const [products, setProducts] = useState<Product[]>([]);
    const [orders, setOrders] = useState<Order[]>([]);
    const [quotes, setQuotes] = useState<Quote[]>([]);

    // -- UI State --
    const [showAddProduct, setShowAddProduct] = useState(false);
    const [showArchived, setShowArchived] = useState(false);
    const [isSeedingReviews, setIsSeedingReviews] = useState(false);

    // -- Pagination State --
    const [ordersPage, setOrdersPage] = useState(1);
    const [quotesPage, setQuotesPage] = useState(1);

    // -- Order Filter State --
    const [orderDateFilter, setOrderDateFilter] = useState('all');
    const [orderStartDate, setOrderStartDate] = useState('');
    const [orderEndDate, setOrderEndDate] = useState('');
    const [expandedAdminOrderId, setExpandedAdminOrderId] = useState<string | null>(null);
    const [updatingOrder, setUpdatingOrder] = useState(false);

    // -- Quote Filter State --
    const [quoteDateFilter, setQuoteDateFilter] = useState('all');
    const [quoteStartDate, setQuoteStartDate] = useState('');
    const [quoteEndDate, setQuoteEndDate] = useState('');

    // -- Product Filter State --
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCategory, setFilterCategory] = useState('all');
    const [filterSubCategory, setFilterSubCategory] = useState('all');
    const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);

    // -- Modal State --
    const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);

    // -- Form State (Add/Edit Product) --
    const [newProduct, setNewProduct] = useState<ProductFormState>({
        name: '', description: '', short_description: '', price: '', stock: '', category: '3d_printer', sub_category:'', imageFiles: [], videoFile: null, specs: [], allow_cod_override: false
    });
    const [newProductImagePreviews, setNewProductImagePreviews] = useState<string[]>([]);

    const [editingProductId, setEditingProductId] = useState<string | null>(null);
    const [editingProductData, setEditingProductData] = useState<ProductFormState>({
        name: '', description: '', short_description: '', price: '', stock: '', category: '3d_printer', sub_category: '', imageFiles: [], videoFile: null, specs:[], allow_cod_override: false
    });
    const [editingProductImages, setEditingProductImages] = useState<EditingProductImageState[]>([]);
    const [editingVideoPreview, setEditingVideoPreview] = useState<string | null>(null);

    // --- INITIALIZATION ---
    useEffect(() => { checkAdminAccess(); }, []);

    // Re-fetch when Archive toggle changes
    useEffect(() => {
        if (isAdmin) fetchDashboardData();
    }, [showArchived, isAdmin]);

    // Cleanup blobs
    useEffect(() => { return () => newProductImagePreviews.forEach(url => URL.revokeObjectURL(url)); }, []);

    // Filter Logic for Products
    useEffect(() => {
        let result = [...products];
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            result = result.filter(p =>
                p.name.toLowerCase().includes(lower) ||
                (p.category || '').toLowerCase().includes(lower) ||
                (p.sub_category || '').toLowerCase().includes(lower)
            );
        }
        if (filterCategory !== 'all') {
            result = result.filter(p => p.category === filterCategory);
        }
        if (filterSubCategory !== 'all') {
            result = result.filter(p => p.sub_category === filterSubCategory);
        }
        setDisplayedProducts(result);
    }, [products, searchTerm, filterCategory, filterSubCategory]);

    useEffect(() => {
        setFilterSubCategory('all');
    }, [filterCategory]);

    // ✅ FIXED ADMIN VERIFICATION
    const checkAdminAccess = async () => {
        try {
            const token = localStorage.getItem('auth_token');
            if (!token) {
                navigate('/auth');
                return;
            }

            const res = await apiService.getCurrentUser();

            // Check if the API returned an error object instead of blowing up silently
            if (res.error) {
                throw new Error(res.error);
            }

            // Safely extract the role
            const userRole = res.role || res.user?.role;

            if (userRole !== 'admin') {
                console.error("Access check failed. Received role:", userRole);
                toast.error('Access denied. Admin privileges required.');
                navigate('/');
                return;
            }

            setIsAdmin(true);
            await fetchDashboardData();
        } catch (e: any) {
            console.error("Admin verification error:", e);
            toast.error('Failed to verify admin status: ' + (e.message || 'Unknown error'));
            navigate('/auth');
        } finally {
            setIsLoading(false);
        }
    };

    const fetchDashboardData = async () => {
        try {
            const productsRes = await apiService.request(
                showArchived ? '/products?show_archived=true' : '/products'
            );
            const rawProducts: any = productsRes.data ?? productsRes;

            const ordersRes = await apiService.getAdminOrders();
            const rawOrders: any = ordersRes.data ?? ordersRes;

            const quotesRes = await apiService.request('/quotes/admin/all');
            const rawQuotes: any = (quotesRes as any).data ?? quotesRes;

            const productsWithSales: Product[] = rawProducts.map(
                (p: any) => ({
                    ...p,
                    totalSales: (p.totalSales as number) ?? 0,
                })
            );

            setProducts(productsWithSales);
            setOrders(rawOrders as Order[]);
            setQuotes(Array.isArray(rawQuotes) ? rawQuotes : []);
        } catch (error: any) {
            console.error('Dashboard fetch error:', error);
            toast.error('Failed to load dashboard data');
        }
    };

    // --- PRODUCT FORM HANDLERS ---
    const addSpecField = (isEditing: boolean) => {
        const setter = isEditing ? setEditingProductData : setNewProduct;
        setter(prev => ({ ...prev, specs: [...prev.specs, { key: '', value: '' }] }));
    };

    const removeSpecField = (isEditing: boolean, index: number) => {
        const setter = isEditing ? setEditingProductData : setNewProduct;
        setter(prev => ({ ...prev, specs: prev.specs.filter((_, i) => i !== index) }));
    };

    const updateSpecField = (isEditing: boolean, index: number, field: 'key' | 'value', value: string) => {
        const setter = isEditing ? setEditingProductData : setNewProduct;
        setter(prev => {
            const newSpecs = [...prev.specs];
            newSpecs[index][field] = value;
            return { ...prev, specs: newSpecs };
        });
    };

    const handleNewProductImagesUpload = useCallback((files: File[]) => {
        const total = newProduct.imageFiles.length + files.length;
        if (total > 7) { toast.error('Max 7 images'); return; }

        const previews = files.map(file => URL.createObjectURL(file));
        setNewProductImagePreviews(prev => [...prev, ...previews]);
        setNewProduct(prev => ({ ...prev, imageFiles: [...prev.imageFiles, ...files] }));
    }, [newProduct.imageFiles]);

    const removeNewProductImage = (index: number) => {
        URL.revokeObjectURL(newProductImagePreviews[index]);
        setNewProductImagePreviews(prev => prev.filter((_, i) => i !== index));
        setNewProduct(prev => ({ ...prev, imageFiles: prev.imageFiles.filter((_, i) => i !== index) }));
    };

    const handleAddProduct = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const specsObject = newProduct.specs.reduce((acc, item) => {
                if (item.key.trim()) acc[item.key] = item.value;
                return acc;
            }, {} as Record<string, string>);

            // Media goes straight to Cloudinary; only the resulting URLs are
            // sent to the API, which cannot carry files (6MB Lambda limit).
            const images = await Promise.all(
                newProduct.imageFiles.map((f: File) => apiService.uploadProductMedia(f, 'image'))
            );
            const videoUrl = newProduct.videoFile
                ? await apiService.uploadProductMedia(newProduct.videoFile, 'video')
                : null;

            await apiService.createProduct({
                name: newProduct.name,
                description: newProduct.description,
                short_description: newProduct.short_description,
                price: newProduct.price,
                stock: newProduct.stock,
                category: newProduct.category,
                sub_category: newProduct.sub_category,
                specifications: JSON.stringify(specsObject),
                images,
                videoUrl,
            });
            toast.success('Product created');
            setShowAddProduct(false);
            setNewProductImagePreviews([]);
            setNewProduct({ name: '', description: '', short_description: '', price: '', stock: '', category: '3d_printer', sub_category:'', imageFiles: [], videoFile: null, specs: [], allow_cod_override: false });
            fetchDashboardData();
        } catch (e: any) { toast.error(e.message || 'Failed to create'); }
    };

    // --- EDIT PRODUCT HANDLERS ---
    const startEditProduct = (p: Product) => {
        setEditingProductId(p.id);
        
        let specsArray: SpecItem[] = [];
        let hasOverride = false;
        
        if (p.specifications) {
            if (Array.isArray(p.specifications)) {
                hasOverride = p.specifications.some((s: any) => s.key === 'allow_cod_override' && String(s.value).toLowerCase() === 'true');
                specsArray = p.specifications.filter((s: any) => s.key !== 'allow_cod_override').map((s: any) => ({ key: s.key, value: String(s.value) }));
            } else {
                hasOverride = String((p.specifications as any).allow_cod_override).toLowerCase() === 'true';
                specsArray = Object.entries(p.specifications).filter(([k]) => k !== 'allow_cod_override').map(([key, value]) => ({ key, value: String(value) }));
            }
        }

        setEditingProductData({
            name: p.name, description: p.description || '', short_description: p.short_description || '',
            price: String(p.price), stock: String(p.stock), category: p.category, sub_category: p.sub_category || '',
            imageFiles: [], videoFile: null, specs: specsArray, allow_cod_override: hasOverride
        });
        setEditingVideoPreview(p.video_url || null);
        const imgs = (p.product_images || []).sort((a,b) => a.display_order - b.display_order)
            .map(i => ({ id: i.id, url: i.image_url || i.image_data || '', isNew: false }))
            .filter(i => i.url);
        setEditingProductImages(imgs);
    };

    const cancelEditProduct = () => {
        editingProductImages.forEach(img => { if (img.url.startsWith('blob:')) URL.revokeObjectURL(img.url); });
        setEditingProductId(null);
        setEditingVideoPreview(null);
        setEditingProductImages([]);
    };

    const handleEditProductImagesUpload = useCallback((files: File[]) => {
        if (editingProductImages.length + files.length > 7) { toast.error('Max 7 images'); return; }

        const newImages = files.map(file => ({
            id: `new-${Date.now()}-${Math.random()}`, url: URL.createObjectURL(file), isNew: true
        }));
        setEditingProductImages(prev => [...prev, ...newImages]);
        setEditingProductData(prev => ({ ...prev, imageFiles: [...prev.imageFiles, ...files] }));
    }, [editingProductImages]);

    const removeEditProductImage = (index: number) => {
        const image = editingProductImages[index];
        if (image.url.startsWith('blob:')) URL.revokeObjectURL(image.url);
        setEditingProductImages(prev => prev.filter((_, i) => i !== index));
        if (image.isNew) {
            const newFileIndex = editingProductImages.slice(0, index).filter(img => img.isNew).length;
            setEditingProductData(prev => ({ ...prev, imageFiles: prev.imageFiles.filter((_, i) => i !== newFileIndex) }));
        }
    };

    const saveEditedProduct = async () => {
        if (!editingProductId) return;
        try {
            const specsObject = editingProductData.specs.reduce((acc, item) => {
                if (item.key.trim()) acc[item.key] = item.value;
                return acc;
            }, {} as Record<string, string>);

            const images = await Promise.all(
                editingProductData.imageFiles.map((f: File) => apiService.uploadProductMedia(f, 'image'))
            );
            const videoUrl = editingProductData.videoFile
                ? await apiService.uploadProductMedia(editingProductData.videoFile, 'video')
                : null;

            const payload: Record<string, unknown> = {
                name: editingProductData.name,
                description: editingProductData.description,
                short_description: editingProductData.short_description,
                price: editingProductData.price,
                stock: editingProductData.stock,
                category: editingProductData.category,
                sub_category: editingProductData.sub_category,
                specifications: JSON.stringify(specsObject),
                images,
                videoUrl,
            };

            const imagesToDelete = products.find(p => p.id === editingProductId)?.product_images
                ?.filter(img => !editingProductImages.some(ei => ei.id === img.id))
                .map(img => img.id) || [];

            if (imagesToDelete.length) payload.imagesToDelete = imagesToDelete;

            await apiService.updateProduct(editingProductId, payload);
            toast.success('Product updated');
            setEditingProductId(null);
            cancelEditProduct();
            fetchDashboardData();
        } catch (e: any) { toast.error(e.message || 'Update failed'); }
    };

    const ImageDropzone = ({ onDrop, disabled }: { onDrop: (files: File[]) => void, disabled?: boolean }) => {
        const { getRootProps, getInputProps, isDragActive } = useDropzone({
            onDrop,
            accept: { 'image/*': [] },
            disabled
        });

        return (
            <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-md flex flex-col items-center justify-center cursor-pointer aspect-square hover:bg-muted/50 transition-colors ${
                    isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'
                }`}
            >
                <input {...getInputProps()} />
                {isDragActive ? (
                    <Upload className="h-6 w-6 text-primary animate-bounce" />
                ) : (
                    <Plus className="h-6 w-6 text-muted-foreground" />
                )}
                {isDragActive && <span className="text-[10px] text-primary font-bold mt-1">Drop Here</span>}
            </div>
        );
    };

    const handleArchiveProduct = async (id: string) => {
        const isRestoring = showArchived;
        const confirmMsg = isRestoring
            ? "Are you sure you want to restore this product?"
            : "Are you sure you want to archive this product? It will be hidden from the shop.";

        if (!window.confirm(confirmMsg)) return;

        try {
            if (isRestoring) {
                await apiService.restoreProduct(id);
                toast.success("Product Restored");
            } else {
                await apiService.deleteProduct(id);
                toast.success("Product Archived");
            }
            fetchDashboardData();
        } catch (e) {
            toast.error("Action failed");
        }
    };

    const handleSeedReviews = async () => {
        if (!window.confirm("This will inject authentic 4 and 5 star reviews into ALL products. Proceed?")) return;
        setIsSeedingReviews(true);
        try {
            const res = await apiService.request('/products/seed-reviews', { method: 'POST' });
            toast.success((res as any).message || "Reviews generated successfully!");
            fetchDashboardData(); // Refresh UI to show new star ratings
        } catch (e: any) {
            toast.error(e.message || "Failed to generate reviews");
        } finally {
            setIsSeedingReviews(false);
        }
    };

    // --- ORDER HANDLERS & FILTERS ---
    const getFilteredOrders = () => {
        if (orderDateFilter === 'all') return orders;
        const now = new Date();
        return orders.filter(order => {
            const d = new Date(order.created_at);
            if (orderDateFilter === 'last_day') return d.getTime() >= now.getTime() - 86400000;
            if (orderDateFilter === 'last_week') return d.getTime() >= now.getTime() - 604800000;
            if (orderDateFilter === 'last_month') return d.getTime() >= now.getTime() - 2592000000;
            if (orderDateFilter === 'last_year') return d.getTime() >= now.getTime() - 31536000000;
            if (orderDateFilter === 'date' && orderStartDate) {
                const s = new Date(orderStartDate);
                return d.getDate() === s.getDate() && d.getMonth() === s.getMonth() && d.getFullYear() === s.getFullYear();
            }
            if (orderDateFilter === 'range' && orderStartDate && orderEndDate) {
                const start = new Date(orderStartDate);
                const end = new Date(orderEndDate);
                end.setHours(23, 59, 59, 999);
                return d >= start && d <= end;
            }
            return true;
        });
    };

    const handleUpdateOrderStatus = async (id: string, status: string) => {
        setUpdatingOrder(true);
        try {
            await apiService.updateOrderStatus(id, status);
            setOrders(prev => prev.map(o => o.id === id ? { ...o, status } : o));
            toast.success(`Order updated to ${status}`);
        } catch (e: any) { toast.error(e.message || 'Update failed'); }
        setUpdatingOrder(false);
    };

    // --- QUOTE HANDLERS & FILTERS ---
    const getFilteredQuotes = () => {
        if (quoteDateFilter === 'all') return quotes;
        const now = new Date();
        return quotes.filter(quote => {
            const d = new Date(quote.created_at);
            if (quoteDateFilter === 'last_day') return d.getTime() >= now.getTime() - 86400000;
            if (quoteDateFilter === 'last_week') return d.getTime() >= now.getTime() - 604800000;
            if (quoteDateFilter === 'last_month') return d.getTime() >= now.getTime() - 2592000000;
            if (quoteDateFilter === 'last_year') return d.getTime() >= now.getTime() - 31536000000;
            if (quoteDateFilter === 'date' && quoteStartDate) {
                const s = new Date(quoteStartDate);
                return d.getDate() === s.getDate() && d.getMonth() === s.getMonth() && d.getFullYear() === s.getFullYear();
            }
            if (quoteDateFilter === 'range' && quoteStartDate && quoteEndDate) {
                const start = new Date(quoteStartDate);
                const end = new Date(quoteEndDate);
                end.setHours(23, 59, 59, 999);
                return d >= start && d <= end;
            }
            return true;
        });
    };

    const handleQuoteStatusUpdate = async (id: string, newStatus: string) => {
        try {
            await apiService.request(`/quotes/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
            setQuotes(prev => prev.map(q => q.id === id ? { ...q, status: newStatus } : q));
            toast.success("Quote updated");
        } catch (e) { toast.error("Update failed"); }
    };

    // --- DERIVED STATE ---
    const filteredOrders = getFilteredOrders();
    const totalOrderPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
    const displayedOrders = filteredOrders.slice((ordersPage - 1) * ORDERS_PER_PAGE, ordersPage * ORDERS_PER_PAGE);

    const filteredQuotes = getFilteredQuotes();
    const totalQuotePages = Math.ceil(filteredQuotes.length / QUOTES_PER_PAGE);
    const displayedQuotes = filteredQuotes.slice((quotesPage - 1) * QUOTES_PER_PAGE, quotesPage * QUOTES_PER_PAGE);

    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const lowStockProducts = products.filter(p => p.stock > 0 && p.stock < 5 && !p.is_archived);
    const outOfStockProducts = products.filter(p => p.stock === 0 && !p.is_archived);
    const avgOrderValue = orders.length > 0 ? totalRevenue / orders.length : 0;

    // --- RENDER HELPERS ---
    const renderSpecInputs = (isEditing: boolean, specs: SpecItem[]) => (
        <div className="space-y-3">
            <div className="flex justify-between items-center">
                <Label>Specifications</Label>
                <Button type="button" variant="outline" size="sm" onClick={() => addSpecField(isEditing)}>
                    <Plus className="w-3 h-3 mr-1" /> Add Spec
                </Button>
            </div>
            {specs.map((spec, index) => (
                <div key={index} className="flex gap-2 items-center">
                    <Input placeholder="Key" value={spec.key} onChange={(e) => updateSpecField(isEditing, index, 'key', e.target.value)} className="flex-1"/>
                    <span className="text-muted-foreground">:</span>
                    <Input placeholder="Value" value={spec.value} onChange={(e) => updateSpecField(isEditing, index, 'value', e.target.value)} className="flex-1"/>
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeSpecField(isEditing, index)} className="text-red-500"><Trash2 className="w-4 h-4" /></Button>
                </div>
            ))}
        </div>
    );

    const QuoteSpecsModal = ({ quote, onClose }: { quote: any, onClose: () => void }) => {
        if (!quote) return null;
        let specs = quote.specifications || {};
        if (typeof specs === 'string') { try { specs = JSON.parse(specs); } catch (e) { specs = {}; } }
        const stats = specs.originalStats || {};
        const printDims = specs.printDimensions || {};

        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                <div className="bg-background rounded-xl border shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                    <div className="p-6 border-b flex justify-between items-center bg-muted/20 sticky top-0 bg-background/95 backdrop-blur z-10">
                        <div><h3 className="text-xl font-bold flex items-center gap-2"><FileText className="text-primary" />{quote.file_name}</h3><p className="text-sm text-muted-foreground mt-1">Submitted by {quote.email}</p></div>
                        <Button variant="ghost" size="icon" onClick={onClose}><X /></Button>
                    </div>
                    <div className="p-6 space-y-8">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-3 bg-green-50 dark:bg-green-950/30 rounded-lg border border-green-100 dark:border-green-900 text-center"><div className="text-xs font-bold uppercase text-green-600 mb-1">Price</div><div className="font-bold text-lg">₹{quote.estimated_price}</div></div>
                            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-100 dark:border-blue-900 text-center"><div className="text-xs font-bold uppercase text-blue-600 mb-1">Time</div><div className="font-bold text-lg">{specs.estimatedTime || 'N/A'}</div></div>
                            <div className="p-3 bg-orange-50 dark:bg-orange-950/30 rounded-lg border border-orange-100 dark:border-orange-900 text-center"><div className="text-xs font-bold uppercase text-orange-600 mb-1">Weight</div><div className="font-bold text-lg">{specs.estimatedWeight || 'N/A'}</div></div>
                            <div className="p-3 bg-purple-50 dark:bg-purple-950/30 rounded-lg border border-purple-100 dark:border-purple-900 text-center"><div className="text-xs font-bold uppercase text-purple-600 mb-1">Volume</div><div className="font-bold text-lg">{stats.volume?.toFixed(2) || 0} cm³</div></div>
                        </div>
                        <div><h4 className="font-semibold border-b pb-2 mb-3 flex items-center gap-2"><Layers size={16} /> Print Settings</h4><div className="grid grid-cols-2 gap-4 text-sm"><div className="space-y-1"><span className="text-muted-foreground text-xs uppercase">Material</span><p className="font-medium">{specs.material || 'N/A'}</p></div><div className="space-y-1"><span className="text-muted-foreground text-xs uppercase">Quality</span><p className="font-medium">{specs.quality || 'Standard'}</p></div><div className="space-y-1"><span className="text-muted-foreground text-xs uppercase">Infill</span><p className="font-medium">{specs.infill || '20%'}</p></div><div className="space-y-1"><span className="text-muted-foreground text-xs uppercase">Scale</span><p className="font-medium">{specs.scale || '100%'}</p></div></div></div>
                        <div><h4 className="font-semibold border-b pb-2 mb-3 flex items-center gap-2"><Maximize size={16} /> Geometry & Dimensions</h4><div className="bg-muted/30 p-4 rounded-lg space-y-4 text-sm"><div className="grid grid-cols-2 gap-x-8 gap-y-2"><div className="text-muted-foreground">Print Dimensions</div><div className="font-mono font-medium text-right">{printDims.x ? `${printDims.x} x ${printDims.y} x ${printDims.z} mm` : 'N/A'}</div><div className="text-muted-foreground">Original Dimensions</div><div className="font-mono text-right text-muted-foreground">{stats.dimensions ? `${stats.dimensions.x?.toFixed(2)} x ${stats.dimensions.y?.toFixed(2)} x ${stats.dimensions.z?.toFixed(2)} mm` : 'N/A'}</div><div className="text-muted-foreground">Rotation</div><div className="font-mono text-right">{specs.rotation || 'None'}</div><div className="text-muted-foreground">Triangle Count</div><div className="font-mono text-right">{stats.triangles?.toLocaleString() || 'N/A'}</div></div></div></div>
                        {quote.admin_notes && (<div className="bg-yellow-50 dark:bg-yellow-950/20 p-4 rounded-md border border-yellow-100 dark:border-yellow-900"><span className="text-xs font-bold uppercase text-yellow-700 dark:text-yellow-500 mb-1 block">User Notes</span><p className="text-sm">{quote.admin_notes}</p></div>)}
                        <div className="flex gap-3"><Button className="flex-1" onClick={() => openQuoteFile(quote.id)}>Download STL File</Button><Button variant="outline" onClick={onClose}>Close</Button></div>
                    </div>
                </div>
            </div>
        );
    };

    if (isLoading) return <div className="min-h-screen flex items-center justify-center pt-20"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    if (!isAdmin) return null;

    return (
        <div className="min-h-screen pt-20 pb-10">
            <div className="container mx-auto px-4">
                <div className="mb-8">
                    <h1 className="font-display text-4xl mb-2">Admin Dashboard</h1>
                    <p className="text-muted-foreground">Monitor sales and manage products</p>
                </div>

                {/* ALERTS */}
                {(lowStockProducts.length > 0 || outOfStockProducts.length > 0) && (
                    <div className="mb-6">
                        <Card className="border-orange-500 bg-orange-50/10">
                            <CardHeader className="pb-2">
                                <div className="flex items-center gap-2">
                                    <AlertTriangle className="h-5 w-5 text-orange-500" /><CardTitle className="text-orange-500 text-base">Inventory Alerts</CardTitle>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {outOfStockProducts.length > 0 && <div className="p-3 bg-red-50 dark:bg-red-950 rounded-lg border border-red-100"><p className="font-semibold text-red-700 dark:text-red-400 text-sm">Out of Stock ({outOfStockProducts.length})</p></div>}
                                    {lowStockProducts.length > 0 && <div className="p-3 bg-orange-50 dark:bg-orange-950 rounded-lg border border-orange-100"><p className="font-semibold text-orange-700 dark:text-orange-400 text-sm">Low Stock ({lowStockProducts.length})</p></div>}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                )}

                {/* STATS GRID */}
                <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <Card><CardHeader className="pb-2 flex flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Total Revenue</CardTitle><DollarSign className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{formatINR(totalRevenue)}</div></CardContent></Card>
                    <Card><CardHeader className="pb-2 flex flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Total Orders</CardTitle><ShoppingCart className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{orders.length}</div></CardContent></Card>
                    <Card><CardHeader className="pb-2 flex flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Products</CardTitle><Package className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{products.length}</div></CardContent></Card>
                    <Card><CardHeader className="pb-2 flex flex-row items-center justify-between"><CardTitle className="text-sm font-medium">Avg Order</CardTitle><TrendingUp className="h-4 w-4 text-muted-foreground"/></CardHeader><CardContent><div className="text-2xl font-bold">{formatINR(avgOrderValue)}</div></CardContent></Card>
                </div>

                {/* INVENTORY SECTION */}
                <Card className="mb-8">
                    <CardHeader>
                        <div className="flex justify-between items-center">
                            <div><CardTitle>Inventory</CardTitle><CardDescription>Manage catalog</CardDescription></div>
                            <div className="flex items-center gap-2">
                                {/* ✅ THE NEW SEEDER BUTTON */}
                                <Button 
                                    onClick={handleSeedReviews} 
                                    disabled={isSeedingReviews}
                                    variant="outline" 
                                    size="sm" 
                                    className="hidden md:flex border-yellow-400 text-yellow-600 hover:bg-yellow-50"
                                >
                                    {isSeedingReviews ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Star className="mr-2 h-4 w-4" fill="currentColor" />}
                                    {isSeedingReviews ? 'Generating...' : 'Generate Reviews'}
                                </Button>
                                <Button onClick={() => setShowAddProduct(!showAddProduct)} size="sm"><Plus className="mr-2 h-4 w-4" /> Add Product</Button>
                            </div>
                        </div>
                    </CardHeader>

                    {/* ✅ FILTERS ROW (UPDATED WITH ARCHIVE TOGGLE) */}
                    <div className="px-6 pb-4 flex flex-col sm:flex-row gap-4 border-b items-center">
                        <div className="relative flex-1 w-full"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input placeholder="Search..." className="pl-9" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div>

                        <div className="flex items-center gap-3 w-full sm:w-auto">
                            <Select value={filterCategory} onValueChange={setFilterCategory}><SelectTrigger className="w-[160px]"><SelectValue placeholder="Category" /></SelectTrigger><SelectContent><SelectItem value="all">All</SelectItem>{MAIN_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select>

                            <div className="flex items-center space-x-2 border-l pl-3 ml-2">
                                <Switch
                                    id="archive-mode"
                                    checked={showArchived}
                                    onCheckedChange={setShowArchived}
                                />
                                <Label htmlFor="archive-mode" className="text-sm cursor-pointer whitespace-nowrap">
                                    Show Archived
                                </Label>
                            </div>
                        </div>
                    </div>

                    <CardContent className="pt-6">
                        {showAddProduct && (
                            <div className="mb-8 p-6 border rounded-xl bg-secondary/10">
                                <h3 className="font-bold mb-4 text-lg">Add New Product</h3>
                                <form onSubmit={handleAddProduct} className="space-y-4">
                                    <div className="grid md:grid-cols-2 gap-4">
                                        <div><Label>Name</Label><Input value={newProduct.name} onChange={e => setNewProduct({...newProduct, name: e.target.value})} required /></div>
                                        <div><Label>Price</Label><Input type="number" value={newProduct.price} onChange={e => setNewProduct({...newProduct, price: e.target.value})} required /></div>
                                        <div><Label>Stock</Label><Input type="number" value={newProduct.stock} onChange={e => setNewProduct({...newProduct, stock: e.target.value})} required /></div>
                                        
                                        {/* ✅ MASTER COD OVERRIDE EXPLICIT DROPDOWN (ADD MODE) */}
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 col-span-1 md:col-span-2">
                                            <div><Label>Category</Label><Select value={newProduct.category} onValueChange={val => setNewProduct({...newProduct, category: val, sub_category: ''})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MAIN_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
                                            <div><Label>Sub</Label><Select value={newProduct.sub_category} onValueChange={val => setNewProduct({...newProduct, sub_category: val})} disabled={!SUB_CATEGORIES[newProduct.category]}><SelectTrigger><SelectValue placeholder="None" /></SelectTrigger><SelectContent>{SUB_CATEGORIES[newProduct.category]?.map(sc => <SelectItem key={sc} value={sc}>{sc}</SelectItem>)}</SelectContent></Select></div>
                                            <div>
                                                <Label>COD Override (&gt;₹999)</Label>
                                                <Select value={newProduct.allow_cod_override ? "true" : "false"} onValueChange={val => setNewProduct({...newProduct, allow_cod_override: val === "true"})}>
                                                    <SelectTrigger className={newProduct.allow_cod_override ? "border-green-500 bg-green-50 text-green-700 font-bold" : ""}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="false">Standard Rules</SelectItem>
                                                        <SelectItem value="true" className="text-green-700 font-bold">Force Enable COD</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </div>
                                    <div><Label>Short Desc</Label><Textarea value={newProduct.short_description} onChange={e => setNewProduct({...newProduct, short_description: e.target.value})} maxLength={150} /></div>
                                    {renderSpecInputs(false, newProduct.specs)}
                                    <div><Label>Full Desc</Label><Textarea className="h-32" value={newProduct.description} onChange={e => setNewProduct({ ...newProduct, description: e.target.value })} /></div>
                                    <div>
                                        <Label>Images ({newProductImagePreviews.length}/7)</Label>
                                        <div className="mt-2 grid grid-cols-4 gap-2">
                                            {newProductImagePreviews.map((url, i) => (
                                                <div key={i} className="relative group aspect-square">
                                                    <img src={url} className="w-full h-full object-cover rounded-md border" />
                                                    <button type="button" onClick={() => removeNewProductImage(i)} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full"><X size={12}/></button>
                                                </div>
                                            ))}
                                            {/* ✅ Updated Dropzone */}
                                            <ImageDropzone onDrop={handleNewProductImagesUpload} />
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <Label>Product Video</Label>
                                        <div className="mt-2 border-2 border-dashed rounded-md p-4 flex flex-col items-center justify-center hover:bg-muted/50 cursor-pointer relative">
                                            <input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const file = e.target.files?.[0]; if(file) setNewProduct({...newProduct, videoFile: file}); }} />
                                            {newProduct.videoFile ? <div className="flex items-center gap-2 text-green-600"><FileText className="w-5 h-5" /><span className="text-sm font-medium">{newProduct.videoFile.name}</span><Button type="button" variant="ghost" size="sm" className="z-10 text-red-500" onClick={(e) => { e.stopPropagation(); setNewProduct({...newProduct, videoFile: null}); }}><X size={14} /></Button></div> : <div className="text-center text-muted-foreground"><Upload className="h-6 w-6 mx-auto mb-2" /><span className="text-sm">Click to upload video</span></div>}
                                        </div>
                                    </div>
                                    <div className="flex gap-2 pt-2"><Button type="submit">Create</Button><Button type="button" variant="ghost" onClick={() => setShowAddProduct(false)}>Cancel</Button></div>
                                </form>
                            </div>
                        )}

                        <div className="space-y-4">
                            {displayedProducts.map(product => (
                                <div key={product.id} className="p-4 border rounded-lg hover:bg-muted/5 transition-colors">
                                    {editingProductId === product.id ? (
                                        <div className="space-y-4">
                                            <div className="grid md:grid-cols-2 gap-4">
                                                <div><Label>Name</Label><Input value={editingProductData.name} onChange={e => setEditingProductData({...editingProductData, name: e.target.value})} /></div>
                                                <div><Label>Price</Label><Input type="number" value={editingProductData.price} onChange={e => setEditingProductData({...editingProductData, price: e.target.value})} /></div>
                                                <div><Label>Stock</Label><Input type="number" value={editingProductData.stock} onChange={e => setEditingProductData({...editingProductData, stock: e.target.value})} /></div>
                                                
                                                {/* ✅ MASTER COD OVERRIDE EXPLICIT DROPDOWN (EDIT MODE) */}
                                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 col-span-1 md:col-span-2">
                                                    <div><Label>Category</Label><Select value={editingProductData.category} onValueChange={v => setEditingProductData({...editingProductData, category: v, sub_category: ''})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{MAIN_CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></div>
                                                    <div><Label>Sub</Label><Select value={editingProductData.sub_category} onValueChange={v => setEditingProductData({...editingProductData, sub_category: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{SUB_CATEGORIES[editingProductData.category]?.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select></div>
                                                    <div>
                                                        <Label>COD Override (&gt;₹999)</Label>
                                                        <Select value={editingProductData.allow_cod_override ? "true" : "false"} onValueChange={val => setEditingProductData({...editingProductData, allow_cod_override: val === "true"})}>
                                                            <SelectTrigger className={editingProductData.allow_cod_override ? "border-green-500 bg-green-50 text-green-700 font-bold" : ""}>
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="false">Standard Rules</SelectItem>
                                                                <SelectItem value="true" className="text-green-700 font-bold">Force Enable COD</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                            </div>
                                            <div><Label>Short Desc</Label><Textarea value={editingProductData.short_description} onChange={e => setEditingProductData({...editingProductData, short_description: e.target.value})} /></div>
                                            {renderSpecInputs(true, editingProductData.specs)}
                                            <div><Label>Full Desc</Label><Textarea className="h-32" value={editingProductData.description} onChange={e => setEditingProductData({ ...editingProductData, description: e.target.value })} /></div>
                                            <div>
                                                <Label>Images</Label>
                                                <div className="mt-2 grid grid-cols-5 gap-2">
                                                    {editingProductImages.map((img, i) => (
                                                        <div key={img.id} className="relative group aspect-square">
                                                            <img src={img.url} className="w-full h-full object-cover rounded border" />
                                                            <button onClick={() => removeEditProductImage(i)} className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full"><X size={12}/></button>
                                                        </div>
                                                    ))}
                                                    {/* ✅ Updated Dropzone */}
                                                    <ImageDropzone onDrop={handleEditProductImagesUpload} />
                                                </div>
                                            </div>
                                            <div className="mt-4"><Label>Video</Label>{!editingProductData.videoFile && editingVideoPreview && (<div className="mb-2 p-3 border rounded bg-muted/20 flex items-center justify-between"><div className="flex items-center gap-2"><FileText className="w-4 h-4 text-blue-500" /><a href={editingVideoPreview} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline">View Current</a></div></div>)}<div className="mt-2 border-2 border-dashed rounded-md p-4 flex flex-col items-center justify-center hover:bg-muted/50 cursor-pointer relative"><input type="file" accept="video/*" className="absolute inset-0 opacity-0 cursor-pointer" onChange={(e) => { const file = e.target.files?.[0]; if(file) setEditingProductData({...editingProductData, videoFile: file}); }} />{editingProductData.videoFile ? <div className="flex items-center gap-2 text-green-600"><FileText className="w-5 h-5" /><span className="text-sm font-medium">{editingProductData.videoFile.name}</span><Button type="button" variant="ghost" size="sm" className="z-10 text-red-500" onClick={(e) => { e.stopPropagation(); setEditingProductData({...editingProductData, videoFile: null}); }}><X size={14} /></Button></div> : <div className="text-center text-muted-foreground"><Upload className="h-6 w-6 mx-auto mb-2" /><span className="text-sm">Click to replace</span></div>}</div></div>
                                            <div className="flex gap-2"><Button onClick={saveEditedProduct} size="sm">Save</Button><Button variant="ghost" onClick={cancelEditProduct} size="sm">Cancel</Button></div>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                                            <div className="flex gap-4 items-start flex-1">
                                                <div className="h-24 w-24 bg-white rounded-md overflow-hidden shrink-0 border p-1"><img src={product.image_url || "/placeholder.svg"} alt={product.name} className="w-full h-full object-contain" /></div>
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="font-bold text-lg">{product.name}</span>
                                                        {/* ✅ Safe Access to category */}
                                                        <Badge variant="secondary">{(product.category || 'Unknown').replace(/_/g, ' ')}</Badge>
                                                        {product.sub_category && <Badge variant="outline">{product.sub_category}</Badge>}
                                                        {/* ✅ Archived Badge */}
                                                        {product.is_archived && <Badge className="bg-orange-500 text-white">Archived</Badge>}
                                                    </div>
                                                    <p className="text-sm text-muted-foreground line-clamp-2 max-w-2xl">{product.short_description|| product.description}</p>

                                                    {product.stock < 5 && !product.is_archived && <div className={`text-xs font-medium flex items-center gap-1 ${product.stock === 0 ? 'text-red-600' : 'text-orange-600'}`}><AlertTriangle size={12} />{product.stock === 0 ? "Out of Stock" : `Low Stock: ${product.stock}`}</div>}
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end gap-1 min-w-[100px]">
                                                <span className="font-bold text-xl">{formatINR(product.price)}</span>
                                                <span className="text-sm text-muted-foreground">Stock: {product.stock}</span>
                                                <div className="flex gap-2 w-full mt-2">
                                                    {!product.is_archived && (
                                                        <Button variant="outline" size="sm" onClick={() => startEditProduct(product)} className="flex-1">
                                                            <Edit3 size={14} className="mr-2"/> Edit
                                                        </Button>
                                                    )}

                                                    {/* ✅ Updated Button: Archive instead of Delete */}
                                                    <Button
                                                        variant={product.is_archived ? "outline" : "destructive"}
                                                        size="sm"
                                                        onClick={() => handleArchiveProduct(product.id)}
                                                    >
                                                        {product.is_archived ? (
                                                            <>
                                                                <RefreshCw size={14} className="mr-2"/> Restore
                                                            </>
                                                        ) : (
                                                            <>
                                                                <Archive size={14} className="mr-2" /> Archive
                                                            </>
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* ORDERS SECTION */}
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                        <div><CardTitle>Recent Orders</CardTitle><CardDescription>View and manage orders</CardDescription></div>
                        <div className="flex items-center gap-2">
                            <Select value={orderDateFilter} onValueChange={setOrderDateFilter}>
                                <SelectTrigger className="w-[150px]"><CalendarIcon className="mr-2 h-4 w-4" /><SelectValue placeholder="Date Filter" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Time</SelectItem>
                                    <SelectItem value="last_day">Last 24 Hours</SelectItem>
                                    <SelectItem value="last_week">Last 7 Days</SelectItem>
                                    <SelectItem value="last_month">Last 30 Days</SelectItem>
                                    <SelectItem value="last_year">Last Year</SelectItem>
                                    <SelectItem value="date">Specific Date</SelectItem>
                                    <SelectItem value="range">Date Range</SelectItem>
                                </SelectContent>
                            </Select>
                            {orderDateFilter === 'date' && <Input type="date" className="w-[150px]" value={orderStartDate} onChange={e => setOrderStartDate(e.target.value)} />}
                            {orderDateFilter === 'range' && (
                                <div className="flex items-center gap-2">
                                    <Input type="date" className="w-[140px]" value={orderStartDate} onChange={e => setOrderStartDate(e.target.value)} />
                                    <span>-</span>
                                    <Input type="date" className="w-[140px]" value={orderEndDate} onChange={e => setOrderEndDate(e.target.value)} />
                                </div>
                            )}
                        </div>
                        {totalOrderPages > 1 && (
                            <div className="flex justify-center items-center gap-4 border-l pl-4">
                                <Button variant="outline" size="sm" disabled={ordersPage === 1} onClick={() => setOrdersPage(p => p - 1)}><ChevronLeft className="w-4 h-4 mr-2" /> Prev</Button>
                                <span className="text-sm font-medium">Page {ordersPage}/{totalOrderPages}</span>
                                <Button variant="outline" size="sm" disabled={ordersPage === totalOrderPages} onClick={() => setOrdersPage(p => p + 1)}>Next <ChevronRight className="w-4 h-4 ml-2" /></Button>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="pt-6">
                        {displayedOrders.length === 0 ? <p className="text-center text-muted-foreground py-8">No orders found.</p> : (
                            <div className="space-y-4">
                                {displayedOrders.map(order => (
                                    <Card key={order.id} className="p-6 hover:bg-muted/5 transition-colors">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-4 mb-3">
                                                    <h3 className="text-lg font-semibold">Order {order.id.slice(0, 8)}</h3>
                                                    <Badge className={`${STATUSCOLORS[order.status]} text-white`}>{STATUSLABELS[order.status]}</Badge>
                                                </div>
                                                <div className="grid sm:grid-cols-5 gap-4 text-sm mb-4">
                                                    <div><p className="text-muted-foreground">ID</p><p className="font-medium">{order.id.slice(0,8)}</p></div>
                                                    <div><p className="text-muted-foreground">Date</p><p className="font-medium">{new Date(order.created_at).toLocaleDateString()}</p></div>
                                                    <div><p className="text-muted-foreground">Total</p><p className="font-bold text-primary">{formatINR(order.total_amount)}</p></div>
                                                    <div>
                                                        <p className="text-muted-foreground">Status</p>
                                                        <select value={order.status} onChange={e => handleUpdateOrderStatus(order.id, e.target.value)} disabled={updatingOrder} className="border rounded px-2 py-1 text-sm w-full bg-background">
                                                            {STATUSOPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon" onClick={() => setExpandedAdminOrderId(expandedAdminOrderId === order.id ? null : order.id)}>
                                                <ChevronRight className={`w-5 h-5 transition-transform ${expandedAdminOrderId === order.id ? 'rotate-90' : ''}`} />
                                            </Button>
                                        </div>
                                        {expandedAdminOrderId === order.id && (
                                            <div className="mt-4 border-t pt-4 space-y-4 text-sm">
                                                <div className="grid md:grid-cols-2 gap-6">
                                                    <div><h4 className="font-semibold mb-2">Customer</h4><div className="bg-muted p-3 rounded space-y-1"><p className="font-medium">{order.shipping_address?.fullName || order.user_name || 'N/A'}</p><p className="text-xs text-muted-foreground">{order.shipping_address?.email || order.user_email}</p><p className="text-xs text-muted-foreground">{order.shipping_address?.phone}</p></div></div>
                                                    <div><h4 className="font-semibold mb-2">Shipping</h4><div className="bg-muted p-3 rounded space-y-1"><p>{order.shipping_address?.address}</p><p className="text-xs">{[order.shipping_address?.city, order.shipping_address?.state, order.shipping_address?.pincode].filter(Boolean).join(', ')}</p></div></div>
                                                </div>
                                                <div>
                                                    <h4 className="font-semibold mb-2">Items</h4>
                                                    <div className="space-y-2">
                                                        {order.items?.map((item, idx) => (<div key={idx} className="flex justify-between p-3 bg-muted rounded items-center"><div><p className="font-medium">{item.product?.name || 'Unknown'}</p><p className="text-xs text-muted-foreground">Qty: {item.quantity}</p></div><p className="font-semibold">{formatINR(item.line_total || 0)}</p></div>))}
                                                        <div className="flex justify-between p-3 bg-primary/10 rounded font-bold mt-2"><span>Total</span><span>{formatINR(order.total_amount)}</span></div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </Card>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* QUOTE MANAGEMENT */}
                <Card className="mt-8">
                    <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                        <div><CardTitle>Custom Print Requests</CardTitle><CardDescription>Manage incoming quotes</CardDescription></div>
                        <div className="flex items-center gap-2">
                            <Select value={quoteDateFilter} onValueChange={setQuoteDateFilter}>
                                <SelectTrigger className="w-[150px]"><CalendarIcon className="mr-2 h-4 w-4" /><SelectValue placeholder="Date Filter" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Time</SelectItem>
                                    <SelectItem value="last_day">Last 24 Hours</SelectItem>
                                    <SelectItem value="last_week">Last 7 Days</SelectItem>
                                    <SelectItem value="last_month">Last 30 Days</SelectItem>
                                    <SelectItem value="last_year">Last Year</SelectItem>
                                    <SelectItem value="date">Specific Date</SelectItem>
                                    <SelectItem value="range">Date Range</SelectItem>
                                </SelectContent>
                            </Select>
                            {quoteDateFilter === 'date' && <Input type="date" className="w-[150px]" value={quoteStartDate} onChange={e => setQuoteStartDate(e.target.value)} />}
                            {quoteDateFilter === 'range' && (
                                <div className="flex items-center gap-2">
                                    <Input type="date" className="w-[140px]" value={quoteStartDate} onChange={e => setQuoteStartDate(e.target.value)} />
                                    <span>-</span>
                                    <Input type="date" className="w-[140px]" value={quoteEndDate} onChange={e => setQuoteEndDate(e.target.value)} />
                                </div>
                            )}
                        </div>
                        {totalQuotePages > 1 && (
                            <div className="flex justify-center items-center gap-4 border-l pl-4">
                                <Button variant="outline" size="sm" disabled={quotesPage === 1} onClick={() => setQuotesPage(p => p - 1)}><ChevronLeft className="w-4 h-4 mr-2" /> Prev</Button>
                                <span className="text-sm font-medium">Page {quotesPage}/{totalQuotePages}</span>
                                <Button variant="outline" size="sm" disabled={quotesPage === totalQuotePages} onClick={() => setQuotesPage(p => p + 1)}>Next <ChevronRight className="w-4 h-4 ml-2" /></Button>
                            </div>
                        )}
                    </CardHeader>
                    <CardContent className="pt-6">
                        {displayedQuotes.length === 0 ? <p className="text-center py-8 text-muted-foreground">No pending quotes.</p> : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-xs uppercase bg-muted/50"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">User</th><th className="px-4 py-3">File</th><th className="px-4 py-3">Est. Price</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
                                    <tbody>
                                    {displayedQuotes.map((quote) => (
                                        <tr key={quote.id} className="border-b hover:bg-muted/5">
                                            <td className="px-4 py-3">{new Date(quote.created_at).toLocaleDateString()}</td>
                                            <td className="px-4 py-3"><div className="font-medium">{quote.email}</div><div className="text-xs text-muted-foreground">{quote.phone}</div></td>
                                            <td className="px-4 py-3"><button type="button" onClick={() => openQuoteFile(quote.id)} className="text-blue-600 hover:underline flex items-center gap-1"><FileText size={14} /> {quote.file_name.substring(0, 15)}...</button></td>
                                            <td className="px-4 py-3 font-bold">₹{quote.estimated_price}</td>
                                            <td className="px-4 py-3">
                                                <select value={quote.status} onChange={(e) => handleQuoteStatusUpdate(quote.id, e.target.value)} className={`px-2 py-1 rounded text-xs border ${quote.status==='pending'?'bg-yellow-100':quote.status==='contacted'?'bg-blue-100':quote.status==='completed'?'bg-green-100':''}`}><option value="pending">Pending</option><option value="contacted">Contacted</option><option value="paid">Paid</option><option value="completed">Completed</option><option value="rejected">Rejected</option></select>
                                            </td>
                                            <td className="px-4 py-3"><Button variant="outline" size="sm" onClick={() => setSelectedQuote(quote)}><Eye size={14} className="mr-1"/> View Specs</Button></td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* SPECS MODAL */}
                {selectedQuote && <QuoteSpecsModal quote={selectedQuote} onClose={() => setSelectedQuote(null)} />}
            </div>
        </div>
    );
}
