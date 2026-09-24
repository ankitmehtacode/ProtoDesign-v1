import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

// Mobile browsers resize the viewport as the URL bar shows and hides. Refreshing
// on that would make pinned sections jump mid-scroll, so only real resizes count.
ScrollTrigger.config({ ignoreMobileResize: true });

export { gsap, ScrollTrigger };

/**
 * Pinned sections must be measured top to bottom: each pin adds scroll length
 * that every trigger below it depends on. Creation order is not guaranteed
 * (hot reload, lazy content), so every section calls this after creating its
 * triggers to re-sort by page position and remeasure.
 */
export const refreshInPageOrder = () => {
    ScrollTrigger.sort();
    ScrollTrigger.refresh();
};
