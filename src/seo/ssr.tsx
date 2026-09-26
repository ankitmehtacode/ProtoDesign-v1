/**
 * Build-time rendering for scripts/prerender.mjs. Renders the same components
 * the app shows at these routes, so the static HTML that crawlers and AI
 * assistants read (most do not run JavaScript) matches what visitors see.
 * Loaded through Vite's SSR loader; never shipped to the browser.
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { Faq } from "@/components/Faq";
import { ContactPage, PrivacyPage, RefundPage, ReturnPage, ShippingPage, TermsPage } from "@/pages/Legal";

const PAGES: Record<string, () => ReactElement> = {
    "/terms-and-conditions": () => <TermsPage />,
    "/privacy-policy": () => <PrivacyPage />,
    "/refund-policy": () => <RefundPage />,
    "/return-policy": () => <ReturnPage />,
    "/shipping-policy": () => <ShippingPage />,
    "/contact": () => <ContactPage />,
};

const render = (route: string, el: ReactElement) =>
    renderToStaticMarkup(<MemoryRouter initialEntries={[route]}>{el}</MemoryRouter>);

/** Full page body for a route whose component can render without a browser, or null. */
export function renderPage(route: string): string | null {
    const page = PAGES[route];
    return page ? render(route, page()) : null;
}

/** The FAQ section as shown on /custom. */
export const renderFaq = () => render("/custom", <Faq />);
