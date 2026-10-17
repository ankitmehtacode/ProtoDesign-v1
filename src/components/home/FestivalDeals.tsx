import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { useFestival } from "@/hooks/use-festival";
import { refreshInPageOrder } from "@/lib/gsap";
import { FestivalBanner } from "@/components/shop/FestivalBanner";
import { Product, dealPrice, productImageUrls, sizedImage, sizedSrcSet } from "@/components/shop/product";

const SHOWN = 4;

// The category also holds wash stations and scanners, and half of it has no
// sub-category; the product name is the reliable signal.
const IS_PRINTER = /\bprinter\b/i;

/** A deal price we set ourselves; during a sale every printer shows a struck price. */
const hasStoredDeal = (p: Product) => Number(p.list_compare_at_price) > Number(p.list_price ?? p.price);

/**
 * Printers a first-time buyer can afford, in stock, with a photo: our own
 * deals first, then the cheapest, so the sale reads as a reason to buy now
 * rather than a list of flagships.
 */
function pickDeals(products: Product[]): Product[] {
    return products
        .filter((p) => !p.is_archived && p.stock > 0 && IS_PRINTER.test(p.name) && productImageUrls(p).length > 0)
        .sort((a, b) => Number(hasStoredDeal(b)) - Number(hasStoredDeal(a)) || Number(a.price) - Number(b.price))
        .slice(0, SHOWN);
}

/**
 * Home page, during a festival sale only: the sale's deadline (FestivalBanner)
 * and four printers at the price checkout will charge, each with what the
 * festival takes off our own price. No savings headline is built on the struck
 * reference prices; the festival discount is the claim we fully control.
 */
export const FestivalDeals = () => {
    const sale = useFestival()?.active ?? null;
    const [deals, setDeals] = useState<Product[]>([]);

    useEffect(() => {
        if (!sale) return;
        let cancelled = false;
        apiService
            .getProducts(sale.category)
            .then((res) => {
                const list: Product[] = Array.isArray(res) ? res : res.data || [];
                if (!cancelled) setDeals(pickDeals(list));
            })
            .catch((error) => {
                console.error("Home festival deals: printers unavailable", error);
                if (!cancelled) setDeals([]);
            });
        return () => { cancelled = true; };
    }, [sale]);

    // The scenes below pin by measured scroll position; this section arriving
    // after they measured would leave every pin a section's height off.
    const shown = !!sale && deals.length > 0;
    useEffect(() => {
        if (shown) refreshInPageOrder();
    }, [shown]);

    // Always this wrapper, even empty: GSAP moves the pinned sections around it
    // into spacers, so React inserting a sibling next to them would fail.
    return <div>{shown && <DealsSection saleName={sale.name} deals={deals} />}</div>;
};

function DealsSection({ saleName, deals }: { saleName: string; deals: Product[] }) {
    return (
        <section aria-label={`${saleName} printers`} className="border-t border-border bg-background">
            <div className="container mx-auto px-4 pb-16 pt-6 md:pb-20">
                <FestivalBanner />

                <ul className="mt-8 grid grid-cols-2 gap-4 md:gap-6 lg:grid-cols-4">
                    {deals.map((p) => <DealTile key={p.id} product={p} />)}
                </ul>

                <Link
                    to="/printers"
                    className="group mt-8 inline-flex items-center gap-1 py-2.5 font-medium underline-offset-4 hover:underline"
                >
                    See every printer on sale
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
            </div>
        </section>
    );
}

function DealTile({ product }: { product: Product }) {
    const image = productImageUrls(product)[0];
    const was = dealPrice(product);
    const price = Number(product.price);
    const festivalOff = product.festival ? Number(product.list_price) - price : 0;

    return (
        <li>
            <Link
                to={`/product/${product.slug || product.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_hsl(160_35%_11%/0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                {/* The photo is pinned inside, so a tall one cannot stretch its square. */}
                <div className="relative aspect-square overflow-hidden bg-secondary/60 dark:bg-[hsl(150_18%_88%)]">
                    <img
                        src={sizedImage(image, 480)}
                        srcSet={sizedSrcSet(image, 480)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full object-contain p-4 mix-blend-multiply transition-transform duration-500 group-hover:scale-[1.03] dark:mix-blend-normal"
                    />
                </div>
                <div className="flex flex-1 flex-col p-4">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug md:text-base">{product.name}</h3>
                    <p className="mt-auto pt-3">
                        {was !== null && (
                            <s className="mr-2 text-sm text-muted-foreground">
                                <span className="sr-only">Was </span>{formatINR(was)}
                            </s>
                        )}
                        <span className="text-lg font-bold">
                            <span className="sr-only">Now </span>{formatINR(price)}
                        </span>
                    </p>
                    {festivalOff > 0 && (
                        <p className="mt-1 text-xs font-semibold text-[hsl(var(--festive))]">
                            {formatINR(festivalOff)} off for {product.festival!.name.replace(/ Sale$/, "")}
                        </p>
                    )}
                </div>
            </Link>
        </li>
    );
}
