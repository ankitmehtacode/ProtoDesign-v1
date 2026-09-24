import { useLocation } from "react-router-dom";
import { Seo } from "./Seo";
import { PAGES } from "./site.js";

/** Head tags for routes listed in site.js. Product and 404 pages render their own. */
export function RouteSeo() {
    const { pathname } = useLocation();
    return PAGES[pathname] ? <Seo /> : null;
}
