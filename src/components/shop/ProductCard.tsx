import { forwardRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Check, Heart, Loader2, Plus, Star } from 'lucide-react';
import { formatINR } from '@/lib/currency';
import { CATEGORY_LABELS, Product, isMadeToOrder, productImageUrls as imageUrls } from './product';

// Only genuinely scarce stock earns the badge; flagging most of the catalog would make it noise.
const LOW_STOCK_THRESHOLD = 3;
const NEW_FOR_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The single most useful status for a shopper, or null. One badge at most:
 * stacking several on a small card is noise.
 */
function statusBadge(product: Product): { label: string; tone: 'alert' | 'brand' | 'muted' } | null {
    if (product.stock <= 0) return { label: 'Sold out', tone: 'muted' };
    // Its stock is an order cap, not scarcity; "Only N left" would be false.
    if (isMadeToOrder(product)) return { label: 'Made to order', tone: 'brand' };
    if (product.stock <= LOW_STOCK_THRESHOLD) return { label: `Only ${product.stock} left`, tone: 'alert' };
    if (product.created_at && Date.now() - new Date(product.created_at).getTime() < NEW_FOR_DAYS * DAY_MS) {
        return { label: 'New', tone: 'brand' };
    }
    // Mirrors the server rule: carts containing a printer ship free.
    if (product.category === '3d_printer') return { label: 'Free shipping', tone: 'brand' };
    return null;
}

const BADGE_TONES = {
    alert: 'bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200',
    brand: 'bg-accent text-accent-foreground',
    muted: 'bg-foreground/80 text-background',
} as const;

interface ProductCardProps {
    product: Product;
    liked: boolean;
    /** Resolves true when the item made it into the cart. */
    onAddToCart: (product: Product) => Promise<boolean>;
    onToggleLike: (product: Product) => void;
    /** Position in the grid; staggers the entrance of the first rows only. */
    index: number;
}

// forwardRef: AnimatePresence's popLayout measures exiting cards through a ref.
export const ProductCard = forwardRef<HTMLElement, ProductCardProps>(function ProductCard(
    { product, liked, onAddToCart, onToggleLike, index },
    ref
) {
    const reduceMotion = useReducedMotion();
    const [cartState, setCartState] = useState<'idle' | 'adding' | 'added'>('idle');

    const images = imageUrls(product);
    const badge = statusBadge(product);
    const soldOut = product.stock <= 0;
    const href = `/product/${product.slug || product.id}`;
    const reviewCount = product.review_count || 0;

    const handleAdd = async () => {
        if (cartState !== 'idle') return;
        setCartState('adding');
        const added = await onAddToCart(product);
        setCartState(added ? 'added' : 'idle');
        if (added) setTimeout(() => setCartState('idle'), 1600);
    };

    return (
        <motion.article
            ref={ref}
            layout={!reduceMotion}
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30, delay: reduceMotion ? 0 : Math.min(index, 8) * 0.04 }}
            className="group relative flex flex-col"
        >
            {/* Image well: tinted surface so white product shots read as objects, not boxes. */}
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-secondary/60 transition-shadow duration-300 group-hover:shadow-[0_18px_40px_-18px_hsl(var(--accent)/0.45)]">
                {images.length > 0 ? (
                    <>
                        <img
                            src={images[0]}
                            alt={product.name}
                            loading={index < 4 ? 'eager' : 'lazy'}
                            className={`absolute inset-0 h-full w-full object-contain p-5 mix-blend-multiply transition duration-500 ease-out group-hover:scale-105 dark:mix-blend-normal ${images.length > 1 ? 'group-hover:opacity-0' : ''} ${soldOut ? 'opacity-50 grayscale' : ''}`}
                            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.svg'; }}
                        />
                        {images.length > 1 && (
                            // Second angle on hover: a faster "look closer" than carousel arrows.
                            <img
                                src={images[1]}
                                alt=""
                                aria-hidden
                                loading="lazy"
                                className="absolute inset-0 h-full w-full scale-105 object-contain p-5 opacity-0 mix-blend-multiply transition duration-500 ease-out group-hover:scale-100 group-hover:opacity-100 dark:mix-blend-normal"
                            />
                        )}
                    </>
                ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image yet</div>
                )}

                {badge && (
                    <span className={`absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold ${BADGE_TONES[badge.tone]}`}>
                        {badge.label}
                    </span>
                )}

                <motion.button
                    type="button"
                    onClick={() => onToggleLike(product)}
                    whileTap={reduceMotion ? undefined : { scale: 0.85 }}
                    aria-pressed={liked}
                    aria-label={liked ? `Unlike ${product.name}` : `Like ${product.name}`}
                    className={`absolute right-3 top-3 z-10 flex h-9 min-w-9 items-center justify-center gap-1 rounded-full bg-background/85 px-2.5 text-xs font-semibold shadow-sm backdrop-blur transition-colors ${liked ? 'text-rose-500' : 'text-muted-foreground hover:text-rose-500'}`}
                >
                    <motion.span
                        key={String(liked)}
                        initial={reduceMotion || !liked ? false : { scale: 0.4 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                        className="flex"
                    >
                        <Heart className={`h-4 w-4 ${liked ? 'fill-current' : ''}`} />
                    </motion.span>
                    {product.likes_count > 0 && <span className="tabular-nums">{product.likes_count}</span>}
                </motion.button>
            </div>

            <div className="flex flex-1 flex-col px-1 pt-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{CATEGORY_LABELS[product.category] ?? 'Product'}</span>
                    {reviewCount > 0 && (
                        <span className="flex items-center gap-0.5 font-medium text-foreground">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {Number(product.average_rating || 0).toFixed(1)}
                            <span className="font-normal text-muted-foreground">({reviewCount})</span>
                        </span>
                    )}
                </div>

                {/* Stretched link: the whole card opens the product, while the buttons stay real buttons. */}
                <h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-snug text-foreground md:text-[15px]">
                    <Link to={href} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none after:focus-visible:ring-2 after:focus-visible:ring-ring">
                        {product.name}
                    </Link>
                </h3>

                <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                    <span className="text-base font-bold tabular-nums text-foreground md:text-lg">{formatINR(product.price)}</span>

                    <motion.button
                        type="button"
                        onClick={handleAdd}
                        disabled={soldOut || cartState === 'adding'}
                        whileTap={reduceMotion || soldOut ? undefined : { scale: 0.9 }}
                        aria-label={soldOut ? `${product.name} is sold out` : `Add ${product.name} to cart`}
                        className={`relative z-10 flex h-10 items-center justify-center gap-1.5 overflow-hidden rounded-full px-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                            cartState === 'added'
                                ? 'bg-accent text-accent-foreground'
                                : soldOut
                                    ? 'bg-muted text-muted-foreground'
                                    : 'bg-primary text-primary-foreground hover:bg-primary/85'
                        }`}
                    >
                        <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                                key={soldOut ? 'soldout' : cartState}
                                initial={reduceMotion ? false : { y: 12, opacity: 0 }}
                                animate={{ y: 0, opacity: 1 }}
                                exit={reduceMotion ? undefined : { y: -12, opacity: 0 }}
                                transition={{ duration: 0.18 }}
                                className="flex items-center gap-1.5"
                            >
                                {soldOut ? 'Sold out'
                                    : cartState === 'adding' ? <Loader2 className="h-4 w-4 animate-spin" />
                                    : cartState === 'added' ? <><Check className="h-4 w-4" /><span className="hidden sm:inline">Added</span></>
                                    : <><Plus className="h-4 w-4" /><span className="hidden sm:inline">Add</span></>}
                            </motion.span>
                        </AnimatePresence>
                    </motion.button>
                </div>
            </div>
        </motion.article>
    );
});

/** Placeholder with the card's exact footprint, so the grid does not jump when data lands. */
export function ProductCardSkeleton() {
    return (
        <div className="flex flex-col" aria-hidden>
            <div className="aspect-square animate-pulse rounded-2xl bg-secondary/70" />
            <div className="mt-3 h-3 w-16 animate-pulse rounded-full bg-muted" />
            <div className="mt-2 h-4 w-4/5 animate-pulse rounded-full bg-muted" />
            <div className="mt-4 flex items-center justify-between">
                <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
                <div className="h-10 w-10 animate-pulse rounded-full bg-muted sm:w-16" />
            </div>
        </div>
    );
}
