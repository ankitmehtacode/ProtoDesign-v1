import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from 'sonner';
import { Loader2, ShoppingCart, Search, Heart, Filter, X, Star, Plus } from 'lucide-react';
import { apiService } from '@/services/api.service';
import { useCart } from "@/hooks/use-cart";
import ProductImageCarousel from '@/components/ProductImageCarousel';
import { formatINR } from '@/lib/currency';

interface ProductImage {
    id: string;
    image_url: string;
    image_data?: string;
    display_order: number;
}

interface Product {
    id: string;
    slug?: string; // ✅ Added slug to interface
    name: string;
    description: string;
    short_description?: string;
    price: number;
    stock: number;
    likes_count: number;
    average_rating?: number;
    review_count?: number;
    image_url: string | null;
    category: string;
    created_at?: string;
    product_images?: ProductImage[];
    images?: ProductImage[];
}

interface CategoryPageProps {
    category: string;
    title: string;
    subtitle: string;
    subCategories?: string[];
}

const CategoryPage = ({ category, title, subtitle, subCategories = [] }: CategoryPageProps) => {
    const navigate = useNavigate();
    const { addToCart } = useCart();

    const [allProducts, setAllProducts] = useState<Product[]>([]);
    const [displayedProducts, setDisplayedProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);

    const [searchTerm, setSearchTerm] = useState('');
    const [activeSubCategory, setActiveSubCategory] = useState('all');
    const [sortOption, setSortOption] = useState('newest');

    const [isLiked, setIsLiked] = useState<Record<string, boolean>>({});
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        const loadData = async () => {
            setLoading(true);
            try {
                const res = await apiService.getProducts(category);
                const products = Array.isArray(res) ? res : (res.data || []);

                setAllProducts(products);
                setDisplayedProducts(products);

                if (apiService.isAuthenticated()) {
                    try {
                        const user = await apiService.getCurrentUser();
                        setIsAuthenticated(true);
                        if (user.role === 'admin' || user.user?.role === 'admin') {
                            setIsAdmin(true);
                        }
                    } catch {
                        setIsAuthenticated(false);
                    }
                } else {
                    setIsAuthenticated(false);
                }

            } catch (error) {
                console.error("Failed to load category data", error);
                toast.error("Failed to load products");
            } finally {
                setLoading(false);
            }
        };
        loadData();

        setSearchTerm('');
        setActiveSubCategory('all');
        setSortOption('newest');
    }, [category]);

    useEffect(() => {
        let result = [...allProducts];

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            result = result.filter(p =>
                p.name.toLowerCase().includes(lower) ||
                p.description.toLowerCase().includes(lower) ||
                (p.short_description || '').toLowerCase().includes(lower)
            );
        }

        if (activeSubCategory !== 'all' && subCategories.length > 0) {
            if (activeSubCategory === 'Others') {
                const knownKeywords = subCategories
                    .filter(c => c !== 'Others')
                    .map(c => c.toLowerCase().replace(' fiber', '').replace(' 3d printer', ''));

                result = result.filter(p => {
                    const text = (p.name + ' ' + p.description + ' ' + (p.short_description || '')).toLowerCase();
                    return !knownKeywords.some(k => text.includes(k));
                });
            } else {
                const keyword = activeSubCategory.toLowerCase()
                    .replace(' fiber', '')
                    .replace(' 3d printer', '');

                result = result.filter(p => {
                    const text = (p.name + ' ' + p.description + ' ' + (p.short_description || '')).toLowerCase();
                    return text.includes(keyword);
                });
            }
        }

        result.sort((a, b) => {
            if (sortOption === 'price-low') return a.price - b.price;
            if (sortOption === 'price-high') return b.price - a.price;
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });

        setDisplayedProducts(result);
    }, [searchTerm, activeSubCategory, sortOption, allProducts, subCategories]);

    const clearAll = () => {
        setSearchTerm('');
        setActiveSubCategory('all');
        setSortOption('newest');
    };

    const handleAddToCart = async (product: Product, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isAuthenticated) {
            toast.error("Please sign in to add items");
            navigate('/auth');
            return;
        }
        try {
            await addToCart(product.id, 1);
            toast.success("Added to cart");
            navigate('/cart');
        }
        catch { toast.error("Failed to add to cart"); }
    };

    const handleLike = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isAuthenticated) return toast.error("Sign in to like");

        const currentLiked = isLiked[id];
        setIsLiked(prev => ({ ...prev, [id]: !currentLiked }));

        try {
            if (currentLiked) await apiService.unlikeProduct(id);
            else await apiService.likeProduct(id);
        } catch {
            setIsLiked(prev => ({ ...prev, [id]: currentLiked }));
            toast.error("Failed to update like");
        }
    };

    const handleCreateProduct = async () => {
        if (!isAdmin) return;
        setIsCreating(true);
        try {
            const formData = new FormData();
            formData.append('name', "New Draft Product");
            formData.append('description', "Description goes here...");
            formData.append('short_description', "Short summary");
            formData.append('price', "0");
            formData.append('stock', "0");
            formData.append('category', category === 'all' ? 'uncategorized' : category);
            formData.append('specifications', JSON.stringify({}));
            formData.append('is_archived', 'true');

            const res = await apiService.createProduct(formData);
            const newId = res.id || res.data?.id;

            if (newId) {
                toast.success("Draft created! Redirecting to editor...");
                navigate(`/product/${newId}?edit=true&new=true`);
            } else {
                throw new Error("No ID returned");
            }
        } catch (error) {
            console.error(error);
            toast.error("Failed to create new product");
        } finally {
            setIsCreating(false);
        }
    };

    if (loading) return <div className="min-h-screen pt-32 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>;

    return (
        <div className="min-h-screen pt-20 pb-10 font-sans relative">
            {isAdmin && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="fixed bottom-8 right-8 z-50">
                    <Button size="lg" onClick={handleCreateProduct} disabled={isCreating} className="h-16 w-16 rounded-full shadow-2xl bg-primary hover:bg-primary/90 text-white flex items-center justify-center border-4 border-white/20 backdrop-blur-sm">
                        {isCreating ? <Loader2 className="animate-spin w-8 h-8" /> : <Plus className="w-8 h-8" />}
                    </Button>
                </motion.div>
            )}

            <div className="container mx-auto px-4">
                <section className="py-12 mb-8 rounded-2xl bg-secondary/10 text-center border border-border/50">
                    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                        <h1 className="text-4xl md:text-5xl font-extrabold mb-3 tracking-tight">{title}</h1>
                        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{subtitle}</p>
                    </motion.div>
                </section>

                <section className="top-20 z-30 bg-background/95 backdrop-blur-md border rounded-xl p-3 mb-8 shadow-sm">
                    <div className="flex flex-col lg:flex-row items-center gap-3">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search by name, specs..." className="pl-9 h-10 bg-white" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>

                        {subCategories.length > 0 && (
                            <div className="w-full lg:w-[200px] shrink-0">
                                <Select value={activeSubCategory} onValueChange={setActiveSubCategory}>
                                    <SelectTrigger className="h-10 bg-white"><SelectValue placeholder="Category" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Types</SelectItem>
                                        {subCategories.map(cat => (
                                            <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        )}

                        <div className="w-full lg:w-[180px] shrink-0">
                            <Select value={sortOption} onValueChange={setSortOption}>
                                <SelectTrigger className="h-10 bg-white"><SelectValue placeholder="Sort By" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="newest">Newest Arrivals</SelectItem>
                                    <SelectItem value="price-low">Price: Low to High</SelectItem>
                                    <SelectItem value="price-high">Price: High to Low</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <Button variant="ghost" onClick={clearAll} className="h-10 px-4 text-muted-foreground hover:text-destructive hover:bg-destructive/10 whitespace-nowrap shrink-0">
                            <X className="w-4 h-4 mr-2" /> Clear
                        </Button>
                    </div>
                </section>

                {displayedProducts.length === 0 ? (
                    <div className="text-center py-24 bg-muted/10 rounded-xl border border-dashed border-border">
                        <Filter className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-30" />
                        <h3 className="text-lg font-semibold text-muted-foreground">No products found</h3>
                        <p className="text-sm text-muted-foreground mb-4">Try adjusting your filters or search terms</p>
                        <Button variant="outline" onClick={clearAll}>Clear All Filters</Button>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {displayedProducts.map((product, idx) => {
                            const images = (product.product_images || product.images || []).sort((a,b) => a.display_order - b.display_order);

                            return (
                                <motion.div key={product.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }}>
                                    {/* ✅ THE FIX: Route to slug instead of ID */}
                                    <Card
                                        onClick={() => navigate(`/product/${product.slug || product.id}`)}
                                        className="group h-full flex flex-col overflow-hidden hover:shadow-xl transition-all cursor-pointer border-border/60"
                                    >
                                        <div className="aspect-[4/3] p-4 bg-white relative">
                                            <ProductImageCarousel images={images.length > 0 ? images : [{id:'0', image_url: product.image_url||'', display_order:0}]} productName={product.name} />
                                            <button onClick={(e) => handleLike(product.id, e)} className={`absolute top-3 right-3 py-1 px-2 rounded-full bg-white/90 backdrop-blur-sm shadow-sm transition-all z-10 flex items-center gap-1 text-xs font-medium ${isLiked[product.id] ? 'text-red-500' : 'text-gray-500 hover:text-red-500'}`}>
                                                <Heart className={`w-3.5 h-3.5 ${isLiked[product.id] ? 'fill-current' : ''}`} />
                                                {product.likes_count > 0 && <span>{product.likes_count}</span>}
                                            </button>
                                        </div>

                                        <CardContent className="p-4 flex-1 flex flex-col">
                                            <div className="mb-2">
                                                <h3 className="font-semibold text-foreground line-clamp-1" title={product.name}>{product.name}</h3>
                                                <p className="text-xs text-muted-foreground line-clamp-2 mt-1 min-h-[2.5em]">{product.short_description || product.description}</p>
                                            </div>

                                            <div className="mt-auto pt-4 flex items-center justify-between border-t border-border/50">
                                                <div className="flex flex-col"><span className="font-bold text-lg text-primary">{formatINR(product.price)}</span></div>
                                                <div className="flex items-center gap-1 bg-yellow-50 px-2 py-1 rounded-md border border-yellow-100">
                                                    <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                                                    <span className="text-xs font-semibold text-yellow-700">{product.average_rating ? Number(product.average_rating).toFixed(1) : "0.0"}</span>
                                                    <span className="text-[10px] text-muted-foreground/70">({product.review_count || 0})</span>
                                                </div>
                                            </div>

                                            <Button size="sm" onClick={(e) => handleAddToCart(product, e)} className="w-full mt-3 rounded-md text-xs font-semibold h-9" disabled={product.stock === 0}>
                                                {product.stock > 0 ? <><ShoppingCart className="w-3 h-3 mr-2" /> Add to Cart</> : "Out of Stock"}
                                            </Button>
                                        </CardContent>
                                    </Card>
                                </motion.div>
                            )
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CategoryPage;
