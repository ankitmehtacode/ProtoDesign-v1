import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, LucideIcon, Package, Printer, Upload } from "lucide-react";
import { gsap, refreshInPageOrder } from "@/lib/gsap";
import { apiService } from "@/services/api.service";
import { Product, productImageUrls } from "@/components/shop/product";

/*
 * After the story, the visitor chooses how they want in. Desktop turns the
 * three paths into a pinned horizontal track; phones get a vertical stack whose
 * cards reveal as they arrive, since sideways scroll-jacking on touch fights
 * the thumb.
 */

type Path = {
    icon: LucideIcon;
    kicker: string;
    title: string;
    body: string;
    cta: string;
    to: string;
    categories: string[];
    secondary?: { label: string; to: string };
};

const PATHS: Path[] = [
    {
        icon: Upload,
        kicker: "Have a design?",
        title: "Print it for me",
        body: "Upload your model and get a quote. We handle the printer, the material and the finish.",
        cta: "Get a custom quote",
        to: "/custom",
        categories: [],
    },
    {
        icon: Printer,
        kicker: "Want to make your own?",
        title: "Print it yourself",
        body: "The printers and filaments we trust, ready to ship to your desk.",
        cta: "Shop 3D printers",
        to: "/printers",
        categories: ["3d_printer", "filament"],
        secondary: { label: "Filaments", to: "/filaments" },
    },
    {
        icon: Package,
        kicker: "Just want the thing?",
        title: "Take it home",
        body: "Finished prints designed and made by us. Order it, it arrives.",
        cta: "Shop 3D printables",
        to: "/printables",
        categories: ["3dprintables"],
    },
];

const IMAGES_PER_PATH = 3;

/** First few product photos per path, from the live catalogue. */
function usePathImages() {
    const [images, setImages] = useState<string[][]>(() => PATHS.map(() => []));

    useEffect(() => {
        let cancelled = false;
        apiService
            .getProducts()
            .then((res) => {
                const list: Product[] = (Array.isArray(res) ? res : res.data || []).filter((p: Product) => !p.is_archived);
                if (cancelled) return;
                setImages(
                    PATHS.map((path) =>
                        list
                            .filter((p) => path.categories.includes(p.category))
                            .map((p) => productImageUrls(p)[0])
                            .filter(Boolean)
                            .slice(0, IMAGES_PER_PATH),
                    ),
                );
            })
            // Decorative only: without photos each card keeps its illustrated fallback.
            .catch((error) => console.warn("Home paths: product images unavailable", error));
        return () => { cancelled = true; };
    }, []);

    return images;
}

export const ThreePaths = () => {
    const sectionRef = useRef<HTMLElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const images = usePathImages();

    useLayoutEffect(() => {
        const section = sectionRef.current;
        const track = trackRef.current;
        if (!section || !track) return;

        const mm = gsap.matchMedia();
        const q = gsap.utils.selector(section);

        mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
            const distance = () => track.scrollWidth - window.innerWidth;

            const scroll = gsap.to(track, {
                x: () => -distance(),
                ease: "none", // required: keeps scroll and horizontal position 1:1
                scrollTrigger: {
                    trigger: section,
                    start: "top top",
                    end: () => `+=${distance()}`,
                    pin: true,
                    scrub: 0.8,
                    invalidateOnRefresh: true,
                    anticipatePin: 1,
                },
            });

            // Each card's photos drift against the track, and its copy settles in
            // as the card reaches the middle of the screen.
            q<HTMLElement>("[data-card]").forEach((card) => {
                gsap.fromTo(
                    card.querySelectorAll("[data-photo]"),
                    { xPercent: 9 }, // 9% of a 124%-wide frame stays inside its 12% overscan
                    {
                        xPercent: -9,
                        ease: "none",
                        scrollTrigger: { trigger: card, containerAnimation: scroll, start: "left right", end: "right left", scrub: true },
                    },
                );
                gsap.from(card.querySelectorAll("[data-copy] > *"), {
                    y: 30,
                    autoAlpha: 0,
                    stagger: 0.08,
                    duration: 0.6,
                    ease: "power3.out",
                    scrollTrigger: { trigger: card, containerAnimation: scroll, start: "left 75%", toggleActions: "play none none reverse" },
                });
            });
        });

        mm.add("(max-width: 1023px) and (prefers-reduced-motion: no-preference)", () => {
            q<HTMLElement>("[data-card]").forEach((card) => {
                gsap.from(card.querySelector("[data-media]"), {
                    clipPath: "inset(18% 10% 18% 10% round 24px)",
                    ease: "none",
                    scrollTrigger: { trigger: card, start: "top 95%", end: "top 45%", scrub: 0.4 },
                });
                gsap.from(card.querySelectorAll("[data-copy] > *"), {
                    y: 24,
                    autoAlpha: 0,
                    stagger: 0.07,
                    duration: 0.5,
                    ease: "power3.out",
                    scrollTrigger: { trigger: card, start: "top 70%", toggleActions: "play none none reverse" },
                });
            });
        });

        refreshInPageOrder();
        return () => mm.revert();
    }, []);

    return (
        <section ref={sectionRef} aria-labelledby="paths-heading" className="relative overflow-hidden bg-background">
            <div ref={trackRef} className="flex flex-col gap-6 px-4 py-20 lg:h-[100svh] lg:w-max lg:flex-row lg:items-center lg:gap-10 lg:px-[8vw] lg:py-0">
                <header className="max-w-md lg:w-[34vw] lg:max-w-none lg:shrink-0">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.25em] text-primary">Three ways in</p>
                    <h2 id="paths-heading" className="font-display text-4xl leading-[1.05] md:text-6xl">
                        However you like to make things.
                    </h2>
                    <p className="mt-4 text-lg text-muted-foreground">
                        Bring a design, build your own setup, or skip straight to the finished piece.
                    </p>
                    <p aria-hidden className="mt-8 hidden items-center gap-2 text-sm text-muted-foreground lg:flex">
                        Keep scrolling <ArrowRight className="h-4 w-4" />
                    </p>
                </header>

                {PATHS.map((path, i) => (
                    <article
                        key={path.title}
                        data-card
                        className="flex flex-col overflow-hidden rounded-3xl border border-border bg-card shadow-soft lg:h-[74svh] lg:w-[38vw] lg:shrink-0"
                    >
                        <div data-media className="relative aspect-[4/3] overflow-hidden bg-muted lg:aspect-auto lg:flex-1">
                            <PathArt path={path} index={i} images={images[i]} />
                            <span className="absolute left-4 top-4 rounded-full bg-background/85 px-3 py-1 font-display text-sm backdrop-blur">
                                0{i + 1}
                            </span>
                        </div>
                        <div data-copy className="p-6 lg:p-8">
                            <p className="text-sm font-medium text-primary">{path.kicker}</p>
                            <h3 className="mt-1 font-display text-3xl">{path.title}</h3>
                            <p className="mt-2 text-muted-foreground">{path.body}</p>
                            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
                                <Link
                                    to={path.to}
                                    className="group inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-5 font-medium text-primary-foreground transition-transform active:scale-95"
                                >
                                    {path.cta}
                                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                                </Link>
                                {path.secondary && (
                                    <Link to={path.secondary.to} className="text-sm font-medium underline-offset-4 hover:underline">
                                        {path.secondary.label}
                                    </Link>
                                )}
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
};

/**
 * Product photos when the catalogue has them; an illustration otherwise. The
 * root is overscanned by 12% each side and is what the desktop drift moves, so
 * the effect works whether or not the photos have arrived yet.
 */
function PathArt({ path, index, images }: { path: Path; index: number; images: string[] }) {
    const frame = "absolute inset-y-0 -left-[12%] w-[124%]";

    if (index === 0 || images.length === 0) {
        return (
            <div data-photo className={`${frame} flex items-center justify-center bg-[radial-gradient(circle_at_40%_30%,hsl(var(--primary)/0.25),transparent_60%)]`}>
                <div className="flex flex-col items-center gap-3 text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 border-dashed border-primary/50 text-primary">
                        <path.icon className="h-8 w-8" />
                    </div>
                    {index === 0 && (
                        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">.stl · .obj · .3mf · .step</p>
                    )}
                </div>
            </div>
        );
    }

    const span = (k: number) =>
        images.length === 1 ? "col-span-3 row-span-2"
            : k === 0 ? "col-span-2 row-span-2"
                : images.length === 2 ? "row-span-2" : "";

    return (
        <div data-photo className={`${frame} grid grid-cols-3 grid-rows-2 gap-2 p-2`}>
            {images.map((src, k) => (
                <div key={src} className={`overflow-hidden rounded-2xl bg-background ${span(k)}`}>
                    <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </div>
            ))}
        </div>
    );
}
