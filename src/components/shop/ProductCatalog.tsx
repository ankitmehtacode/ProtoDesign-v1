import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { Loader2, Plus, Search, SearchX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { apiService } from '@/services/api.service';
import { useCart } from '@/hooks/use-cart';
import { ProductCard, ProductCardSkeleton } from './ProductCard';
import { Product } from './product';

export interface CategoryOption {
    value: string;
    label: string;
    /** Keyword-matched sub-types; 'Others' means "matches none of the rest". */
    subCategories?: string[];
}

interface ProductCatalogProps {
    title: string;
    subtitle: string;
    /** Fixed category fetched from the API; omit for the whole catalog. */
    category?: string;
    /** Category chips, shown only for the whole catalog. */
    categories?: CategoryOption[];
    /** Sub-type chips for a fixed category. */
    subCategories?: string[];
}

type SortOption = 'newest' | 'price-low' | 'price-high';
const SORT_LABELS: Record<SortOption, string> = {
    newest: 'Newest',
    'price-low': 'Price: low to high',
    'price-high': 'Price: high to low',
};

const LIKES_STORAGE_KEY = 'user_likes';
const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_COUNT = 8;
const NO_SUBCATEGORIES: string[] = [];

const normalizeKeyword = (subCategory: string) =>
    subCategory.toLowerCase().replace(' fiber', '').replace(' 3d printer', '');

const searchableText = (p: Product) =>
    `${p.name} ${p.description || ''} ${p.short_description || ''}`.toLowerCase();

function matchesSubCategory(product: Product, subCategory: string, all: string[]) {
    const text = searchableText(product);
    if (subCategory === 'Others') {
        return !all.filter((c) => c !== 'Others').map(normalizeKeyword).some((k) => text.includes(k));
    }
    return text.includes(normalizeKeyword(subCategory));
}

function readSavedLikes(): Record<string, boolean> {
    try {
        return JSON.parse(localStorage.getItem(LIKES_STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveLikes(likes: Record<string, boolean>) {
    try {
        localStorage.setItem(LIKES_STORAGE_KEY, JSON.stringify(likes));
    } catch {
        // Storage unavailable (private mode): likes still work for this visit.
    }
}

interface TabOption {
    value: string;
    label: string;
    /** Matching products; tabs with none are dimmed so a tap never lands on an empty grid. */
    count: number;
}

/**
 * Text tabs, not pills: the products are the visual content, the filters should
 * read as navigation. 'primary' sits on a hairline with a sliding underline;
 * 'secondary' is a quieter row of text toggles beneath it.
 */
function FilterTabs({ id, options, value, onChange, label, variant }: {
    id: string;
    options: TabOption[];
    value: string;
    onChange: (value: string) => void;
    label: string;
    variant: 'primary' | 'secondary';
}) {
    const reduceMotion = useReducedMotion();
    const primary = variant === 'primary';
    return (
        <div
            role="group"
            aria-label={label}
            className={`-mx-4 flex overflow-x-auto px-4 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                primary ? 'gap-6 border-b border-border md:gap-8' : 'gap-5 pt-3'
            }`}
        >
            {options.map((option) => {
                const active = option.value === value;
                const empty = option.count === 0 && !active;
                return (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={active}
                        disabled={empty}
                        onClick={() => onChange(option.value)}
                        className={`relative flex shrink-0 items-baseline gap-1 whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-40 ${
                            primary ? 'pb-3 text-[15px] font-semibold' : 'text-sm font-medium'
                        } ${active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        {option.label}
                        <span className={`text-[11px] font-medium tabular-nums ${active ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}>
                            {option.count}
                        </span>
                        {active && primary && (
                            <motion.span
                                layoutId={reduceMotion ? undefined : `tab-${id}`}
                                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground"
                            />
                        )}
                        {active && !primary && (
                            <span className="absolute inset-x-0 -bottom-1 h-px bg-foreground" />
                        )}
                    </button>
                );
            })}
        </div>
    );
}

export function ProductCatalog({ title, subtitle, category, categories, subCategories: fixedSubCategories = NO_SUBCATEGORIES }: ProductCatalogProps) {
    const navigate = useNavigate();
    const { addToCart } = useCart();

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isAdmin, setIsAdmin] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [liked, setLiked] = useState<Record<string, boolean>>({});

    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [activeCategory, setActiveCategory] = useState('all');
    const [activeSubCategory, setActiveSubCategory] = useState('all');
    const [sortOption, setSortOption] = useState<SortOption>('newest');

    const clearAll = () => {
        setSearchTerm('');
        setDebouncedSearch('');
        setActiveCategory('all');
        setActiveSubCategory('all');
        setSortOption('newest');
    };

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchTerm), SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            clearAll();
            try {
                const res = await apiService.getProducts(category);
                const list: Product[] = Array.isArray(res) ? res : (res.data || []);
                if (!cancelled) setProducts(list.filter((p) => !p.is_archived));
            } catch (error) {
                console.error('Failed to load products', error);
                toast.error('Failed to load products');
            } finally {
                if (!cancelled) setLoading(false);
            }

            if (!apiService.isAuthenticated()) return;
            try {
                const user = await apiService.getCurrentUser();
                if (cancelled) return;
                setIsAuthenticated(true);
                setIsAdmin(user.role === 'admin' || user.user?.role === 'admin');
                setLiked(readSavedLikes());
            } catch {
                if (!cancelled) setIsAuthenticated(false);
            }
        };
        load();
        return () => { cancelled = true; };
    }, [category]);

    const subCategoryOptions = useMemo(
        () => (category ? fixedSubCategories : categories?.find((c) => c.value === activeCategory)?.subCategories) ?? [],
        [category, fixedSubCategories, categories, activeCategory]
    );

    const searchResults = useMemo(() => {
        if (!debouncedSearch) return products;
        const needle = debouncedSearch.toLowerCase();
        return products.filter((p) => searchableText(p).includes(needle));
    }, [products, debouncedSearch]);

    const inActiveCategory = useMemo(
        () => (category || activeCategory === 'all' ? searchResults : searchResults.filter((p) => p.category === activeCategory)),
        [searchResults, category, activeCategory]
    );

    const categoryTabs = useMemo<TabOption[]>(() => categories
        ? [{ value: 'all', label: 'All', count: searchResults.length },
            ...categories.map((c) => ({ value: c.value, label: c.label, count: searchResults.filter((p) => p.category === c.value).length }))]
        : [], [categories, searchResults]);

    const subCategoryTabs = useMemo<TabOption[]>(() => subCategoryOptions.length === 0 ? [] : [
        { value: 'all', label: 'All types', count: inActiveCategory.length },
        ...subCategoryOptions.map((s) => ({
            value: s,
            label: s,
            count: inActiveCategory.filter((p) => matchesSubCategory(p, s, subCategoryOptions)).length,
        })),
    ], [subCategoryOptions, inActiveCategory]);

    const visibleProducts = useMemo(() => {
        let result = searchResults;
        if (!category && activeCategory !== 'all') {
            result = result.filter((p) => p.category === activeCategory);
        }
        if (activeSubCategory !== 'all' && subCategoryOptions.length > 0) {
            result = result.filter((p) => matchesSubCategory(p, activeSubCategory, subCategoryOptions));
        }
        return [...result].sort((a, b) => {
            if (sortOption === 'price-low') return a.price - b.price;
            if (sortOption === 'price-high') return b.price - a.price;
            return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        });
    }, [searchResults, category, activeCategory, activeSubCategory, subCategoryOptions, sortOption]);

    const filtersActive = Boolean(searchTerm) || activeCategory !== 'all' || activeSubCategory !== 'all' || sortOption !== 'newest';

    const handleAddToCart = async (product: Product) => {
        if (!isAuthenticated) {
            toast.error('Sign in to add items to your cart');
            navigate('/auth');
            return false;
        }
        return addToCart(product.id, 1);
    };

    const handleToggleLike = async (product: Product) => {
        if (!isAuthenticated) {
            toast.error('Sign in to like products');
            return;
        }
        const wasLiked = Boolean(liked[product.id]);
        const applyLike = (isLiked: boolean) => {
            setLiked((prev) => {
                const next = { ...prev, [product.id]: isLiked };
                saveLikes(next);
                return next;
            });
            setProducts((prev) => prev.map((p) => p.id === product.id
                ? { ...p, likes_count: Math.max(0, p.likes_count + (isLiked ? 1 : -1)) }
                : p));
        };

        applyLike(!wasLiked);
        try {
            if (wasLiked) await apiService.unlikeProduct(product.id);
            else await apiService.likeProduct(product.id);
        } catch {
            applyLike(wasLiked);
            toast.error('Failed to update like');
        }
    };

    const handleCreateProduct = async () => {
        if (!isAdmin) return;
        setIsCreating(true);
        try {
            const formData = new FormData();
            formData.append('name', 'New Draft Product');
            formData.append('description', 'Description goes here...');
            formData.append('short_description', 'Short summary');
            formData.append('price', '0');
            formData.append('stock', '0');
            formData.append('category', category ?? 'uncategorized');
            formData.append('specifications', JSON.stringify({}));
            formData.append('is_archived', 'true');

            const res = await apiService.createProduct(formData);
            const newId = res.id || res.data?.id;
            if (!newId) throw new Error('No ID returned');
            toast.success('Draft created! Redirecting to editor...');
            navigate(`/product/${newId}?edit=true&new=true`);
        } catch (error) {
            console.error(error);
            toast.error('Failed to create new product');
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="relative min-h-[100dvh] pb-16 pt-20">
            {isAdmin && (
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="fixed bottom-8 right-8 z-40">
                    <Button
                        size="lg"
                        onClick={handleCreateProduct}
                        disabled={isCreating}
                        aria-label="Create product"
                        className="h-16 w-16 rounded-full shadow-2xl"
                    >
                        {isCreating ? <Loader2 className="h-8 w-8 animate-spin" /> : <Plus className="h-8 w-8" />}
                    </Button>
                </motion.div>
            )}

            <div className="container mx-auto px-4">
                <header className="max-w-2xl pb-5 pt-8 md:pt-12">
                    <h1 className="text-4xl font-extrabold leading-none tracking-tight text-foreground md:text-6xl">{title}</h1>
                    <p className="mt-3 text-base text-muted-foreground md:text-lg">{subtitle}</p>
                </header>

                {/* Stays under the fixed 80px nav so filters are one thumb-reach away while scrolling. */}
                <div className="sticky top-20 z-30 -mx-4 space-y-4 bg-background/85 px-4 pb-3 pt-3 backdrop-blur-md">
                    <div className="flex items-center gap-2">
                        <label className="relative flex-1">
                            <span className="sr-only">Search products</span>
                            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <input
                                type="search"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search products"
                                className="h-11 w-full rounded-full border border-input bg-card pl-11 pr-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                        </label>
                        <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
                            <SelectTrigger aria-label="Sort products" className="h-11 w-auto shrink-0 gap-2 rounded-full bg-card px-4 text-sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent align="end">
                                {(Object.keys(SORT_LABELS) as SortOption[]).map((key) => (
                                    <SelectItem key={key} value={key}>{SORT_LABELS[key]}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <LayoutGroup>
                        {categoryTabs.length > 0 && (
                            <FilterTabs
                                id="category"
                                label="Category"
                                variant="primary"
                                options={categoryTabs}
                                value={activeCategory}
                                onChange={(value) => { setActiveCategory(value); setActiveSubCategory('all'); }}
                            />
                        )}
                        <AnimatePresence initial={false} mode="wait">
                            {subCategoryTabs.length > 0 && (
                                <motion.div
                                    key={category ?? activeCategory}
                                    initial={{ opacity: 0, y: -4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.18 }}
                                >
                                    <FilterTabs
                                        id="sub"
                                        label="Type"
                                        variant={categoryTabs.length > 0 ? 'secondary' : 'primary'}
                                        options={subCategoryTabs}
                                        value={activeSubCategory}
                                        onChange={setActiveSubCategory}
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </LayoutGroup>
                </div>

                <div className="flex h-12 items-center justify-between text-sm text-muted-foreground" aria-live="polite">
                    {loading ? <span>Loading products</span> : (
                        <span>
                            <span className="font-semibold text-foreground">{visibleProducts.length}</span>{' '}
                            {visibleProducts.length === 1 ? 'product' : 'products'}
                        </span>
                    )}
                    {filtersActive && (
                        <button type="button" onClick={clearAll} className="flex items-center gap-1 rounded-full px-2 py-1 font-medium text-foreground hover:bg-secondary">
                            <X className="h-3.5 w-3.5" /> Clear filters
                        </button>
                    )}
                </div>

                {loading ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 md:gap-x-5 xl:grid-cols-4">
                        {Array.from({ length: SKELETON_COUNT }, (_, i) => <ProductCardSkeleton key={i} />)}
                    </div>
                ) : visibleProducts.length === 0 ? (
                    <div className="flex flex-col items-center rounded-3xl bg-secondary/40 px-6 py-20 text-center">
                        <SearchX className="h-10 w-10 text-muted-foreground" />
                        <h2 className="mt-4 text-lg font-semibold text-foreground">Nothing matches that</h2>
                        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                            {products.length === 0 ? 'New products are on the way. Check back soon.' : 'Try another search or clear your filters.'}
                        </p>
                        {filtersActive && (
                            <Button variant="outline" onClick={clearAll} className="mt-5 rounded-full">Clear filters</Button>
                        )}
                    </div>
                ) : (
                    <motion.div layout className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-3 md:gap-x-5 xl:grid-cols-4">
                        <AnimatePresence mode="popLayout">
                            {visibleProducts.map((product, index) => (
                                <ProductCard
                                    key={product.id}
                                    product={product}
                                    index={index}
                                    liked={Boolean(liked[product.id])}
                                    onAddToCart={handleAddToCart}
                                    onToggleLike={handleToggleLike}
                                />
                            ))}
                        </AnimatePresence>
                    </motion.div>
                )}
            </div>
        </div>
    );
}
