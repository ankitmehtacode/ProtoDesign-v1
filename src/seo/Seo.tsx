import { Helmet } from "react-helmet-async";
import { useLocation } from "react-router-dom";
import {
    DEFAULT_IMAGE, NOT_FOUND, PAGES, SITE_NAME, SITE_URL,
    breadcrumbLd, organizationLd, quoteServiceLd, websiteLd,
} from "./site.js";

type SeoProps = {
    /** Overrides for pages whose metadata comes from data (products). */
    title?: string;
    description?: string;
    canonicalPath?: string;
    image?: string;
    type?: "website" | "product";
    jsonLd?: object[];
    noindex?: boolean;
    notFound?: boolean;
};

/**
 * Head tags for the current route. Static pages read src/seo/site.js, the same
 * config scripts/prerender.mjs bakes into each page's HTML, so what crawlers
 * see before and after JavaScript runs is identical. The prerendered tags
 * carry data-rh, which lets react-helmet-async replace them instead of
 * duplicating them.
 */
export function Seo(props: SeoProps) {
    const { pathname } = useLocation();
    const page = props.notFound ? NOT_FOUND : PAGES[pathname];

    const title = props.title ?? page?.title ?? `${SITE_NAME}`;
    const description = props.description ?? page?.description ?? "";
    const canonical = `${SITE_URL}${props.canonicalPath ?? pathname}`;
    const noindex = props.noindex ?? props.notFound ?? page?.noindex ?? false;

    const ld: object[] = props.jsonLd ?? [];
    if (!props.jsonLd && page && !noindex) {
        if (pathname === "/") ld.push(organizationLd(), websiteLd());
        if (page.crumbs) ld.push(breadcrumbLd(page.crumbs));
        if (page.service) ld.push(quoteServiceLd());
    }

    return (
        <Helmet prioritizeSeoTags>
            <title>{title}</title>
            <meta name="description" content={description} />
            {noindex ? <meta name="robots" content="noindex, follow" /> : <link rel="canonical" href={canonical} />}
            <meta property="og:title" content={title} />
            <meta property="og:description" content={description} />
            <meta property="og:url" content={canonical} />
            <meta property="og:image" content={props.image ?? DEFAULT_IMAGE} />
            <meta property="og:type" content={props.type ?? "website"} />
            <meta name="twitter:title" content={title} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:image" content={props.image ?? DEFAULT_IMAGE} />
            {ld.map((obj, i) => (
                <script key={i} type="application/ld+json">{JSON.stringify(obj)}</script>
            ))}
        </Helmet>
    );
}
