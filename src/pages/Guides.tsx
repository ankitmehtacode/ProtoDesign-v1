/**
 * Printer comparisons (/compare, /compare/:slug) and custom-printing use cases
 * (/3d-printing, /3d-printing/:slug). Content lives in src/seo/guides.js and
 * renders through src/components/GuideViews.tsx, which the prerender also uses;
 * these pages load the catalogue and add the head tags.
 */
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { apiService } from "@/services/api.service";
import { productImageUrls, type Product } from "@/components/shop/product";
import { CompareHubView, ComparisonView, UseCaseHubView, UseCaseView } from "@/components/GuideViews";
import { Seo } from "@/seo/Seo";
import {
    COMPARE_HUB, USE_CASES, USE_CASE_HUB,
    caseHubLd, caseLd, compareDescription, compareHubLd, compareLd, compareTitle, resolveComparisons,
} from "@/seo/guides.js";
import NotFound from "./NotFound";

/** The catalogue's printers, for the comparison pages. */
function usePrinters() {
    const [state, setState] = useState<{ products: Product[] | null; error: string | null }>({ products: null, error: null });
    useEffect(() => {
        let live = true;
        apiService.getProducts("3d_printer")
            .then((res) => { if (live) setState({ products: Array.isArray(res) ? res : (res.data || []), error: null }); })
            .catch((e: Error) => {
                console.error("Failed to load printers", e);
                if (live) setState({ products: null, error: "Could not load printer prices. Please refresh the page." });
            });
        return () => { live = false; };
    }, []);
    return state;
}

const Loading = () => <div className="flex min-h-screen justify-center pt-32"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
const LoadError = ({ message }: { message: string }) => <main className="container mx-auto max-w-4xl px-4 pb-20 pt-28"><p role="alert">{message}</p></main>;

export function ComparePage() {
    const { slug } = useParams();
    const { products, error } = usePrinters();
    if (error) return <LoadError message={error} />;
    if (!products) return <Loading />;
    const all = resolveComparisons(products);
    const r = all.find((x) => x.cmp.slug === slug);
    if (!r) return <NotFound />;
    return (
        <>
            <Seo title={compareTitle(r.cmp)} description={compareDescription(r)} jsonLd={compareLd(r)} image={productImageUrls(r.a)[0]} />
            <ComparisonView r={r} others={all.filter((x) => x !== r)} />
        </>
    );
}

export function CompareHubPage() {
    const { products, error } = usePrinters();
    if (error) return <LoadError message={error} />;
    if (!products) return <Loading />;
    return (
        <>
            <Seo title={COMPARE_HUB.title} description={COMPARE_HUB.description} jsonLd={compareHubLd()} />
            <CompareHubView items={resolveComparisons(products)} />
        </>
    );
}

// --- Use cases ---------------------------------------------------------------

export function UseCasePage() {
    const { slug } = useParams();
    const u = USE_CASES.find((x) => x.slug === slug);
    if (!u) return <NotFound />;
    return (
        <>
            <Seo title={u.title} description={u.description} jsonLd={caseLd(u)} />
            <UseCaseView u={u} />
        </>
    );
}

export function UseCaseHubPage() {
    return (
        <>
            <Seo title={USE_CASE_HUB.title} description={USE_CASE_HUB.description} jsonLd={caseHubLd()} />
            <UseCaseHubView />
        </>
    );
}
