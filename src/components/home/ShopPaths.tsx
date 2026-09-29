import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { apiService } from "@/services/api.service";
import { Product, productImageUrls, sizedImage, sizedSrcSet } from "@/components/shop/product";
import workshop from "@/assets/home/workshop.webp";
import terrain from "@/assets/home/terrain.webp";
import vase from "@/assets/home/vase.webp";
import { SECTION_TITLE } from "./cta";

/*
 * For visitors without a file: the shop, shown with real catalogue photos.
 * A plain grid; the page's one scroll-driven moment is the print story.
 */
// `fallback`: a licensed photo (src/assets/home/CREDITS.md) for when the
// catalogue has no photo for the category or it fails to load.
type Path = { title: string; body: string; to: string; category: string; fallback: string };

const PATHS: Path[] = [
    { title: "3D printers", body: "The machines we print on, ready to ship to your desk.", to: "/printers", category: "3d_printer", fallback: workshop },
    { title: "Filament", body: "PLA, PETG, ABS, nylon and carbon fibre by the spool.", to: "/filaments", category: "filament", fallback: terrain },
    { title: "Ready-made prints", body: "Pieces we designed and printed. Order it, it arrives.", to: "/printables", category: "3dprintables", fallback: vase },
];

/** One photo per path from the live catalogue; a path without one gets its fallback. */
function usePathPhotos() {
    const [photos, setPhotos] = useState<(string | undefined)[]>([]);

    useEffect(() => {
        let cancelled = false;
        apiService
            .getProducts()
            .then((res) => {
                const list: Product[] = (Array.isArray(res) ? res : res.data || []).filter((p: Product) => !p.is_archived);
                if (cancelled) return;
                setPhotos(PATHS.map((path) =>
                    list.filter((p) => p.category === path.category).map((p) => productImageUrls(p)[0]).find(Boolean)));
            })
            // Decorative only: each tile falls back to its own photo.
            .catch((error) => {
                console.warn("Home shop paths: product photos unavailable", error);
                if (!cancelled) setPhotos(PATHS.map(() => undefined));
            });
        return () => { cancelled = true; };
    }, []);

    return photos;
}

export const ShopPaths = () => {
    const photos = usePathPhotos();

    return (
        <section aria-labelledby="shop-heading" className="border-t border-border bg-secondary/40">
            <div className="container mx-auto px-4 py-20 md:py-28">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <h2 id="shop-heading" className={SECTION_TITLE}>
                        Rather print it yourself?
                    </h2>
                    <Link to="/shop" className="group inline-flex items-center gap-1 font-medium underline-offset-4 hover:underline">
                        Browse the whole shop
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                </div>

                <ul className="mt-10 grid gap-6 md:grid-cols-3">
                    {PATHS.map((path, i) => (
                        <li key={path.to}>
                            <Link
                                to={path.to}
                                className="group block overflow-hidden rounded-3xl border border-border bg-card transition-[box-shadow,transform] duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-20px_hsl(160_35%_11%/0.3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            >
                                <TilePhoto src={photos[i]} fallback={path.fallback} loaded={photos.length > 0} />
                                <div className="p-6">
                                    <h3 className="flex items-center justify-between gap-3 text-xl font-semibold">
                                        {path.title}
                                        <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                                    </h3>
                                    <p className="mt-2 text-muted-foreground">{path.body}</p>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
};

/**
 * Catalogue photo, sized for the tile: a soft pulse while the catalogue answers
 * and the photo loads, then a fade in. Missing or broken photos show the
 * path's fallback instead, so a tile is never an empty box.
 */
function TilePhoto({ src, fallback, loaded }: { src?: string; fallback: string; loaded: boolean }) {
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const showFallback = (loaded && !src) || failed;
    const shown = showFallback ? fallback : src;
    const visible = ready || showFallback;

    return (
        <div className={`relative aspect-[4/3] overflow-hidden bg-secondary/60 dark:bg-[hsl(150_18%_88%)] ${visible ? "" : "animate-pulse"}`}>
            {shown && (
                <img
                    key={shown}
                    src={showFallback ? shown : sizedImage(shown, 640)}
                    srcSet={showFallback ? undefined : sizedSrcSet(shown, 640)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onLoad={() => setReady(true)}
                    onError={() => { if (!showFallback) setFailed(true); }}
                    className={`h-full w-full transition-[opacity,transform] duration-500 group-hover:scale-[1.03] ${
                        showFallback ? "object-cover" : "object-contain p-6 mix-blend-multiply dark:mix-blend-normal"
                    } ${visible ? "opacity-100" : "opacity-0"}`}
                />
            )}
        </div>
    );
}
