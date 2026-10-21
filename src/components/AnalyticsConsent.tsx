import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getConsent, identify, onConsentChange, setConsent, track } from "@/lib/analytics";

/*
 * The analytics consent bar, and page-view tracking once it is accepted.
 * Declining is as easy as accepting, either choice is remembered, and the
 * footer's "Analytics preferences" brings this back. The privacy policy's
 * "Analytics" section explains what is collected.
 */
export function AnalyticsConsent() {
    const { pathname } = useLocation();
    const [consent, setConsentState] = useState(getConsent);

    useEffect(() => onConsentChange(setConsentState), []);

    useEffect(() => {
        if (consent !== "granted" || pathname.startsWith("/admin")) return;
        track("page_view", { path: pathname });
        void identify();
    }, [consent, pathname]);

    // Admin pages are the team's own visits: not tracked, and not asked about.
    if (consent !== null || pathname.startsWith("/admin")) return null;

    return (
        <div role="region" aria-label="Analytics consent"
            className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
                <p className="flex-1 text-sm text-muted-foreground">
                    May we record which pages you visit here, so we can see what people look for and improve the shop?
                    If you sign in or send us an enquiry, these visits are linked to you so we can help better.
                    It stays with ProtoDesign and is not used for ads. You can change your mind from the footer. <Link to="/privacy-policy" className="underline">Privacy policy</Link>
                </p>
                <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConsent("denied")}>No thanks</Button>
                    <Button size="sm" onClick={() => setConsent("granted")}>Allow</Button>
                </div>
            </div>
        </div>
    );
}
