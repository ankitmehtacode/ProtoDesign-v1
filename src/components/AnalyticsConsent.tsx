import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
    adsAskedThisVisit, cameFromAd, getAdsConsent, getConsent, identify, onConsentChange, setAdsConsent, setConsent, track,
} from "@/lib/analytics";

// Must match ADS_CONSENT_TEXTS['ads-measurement-v1'] in backend/src/services/leads.service.js.
const ADS_TEXT = "You came here from a Google ad. Also let ProtoDesign tell Google Ads when that visit leads "
    + "to an enquiry or order, so we stop paying for ads that do not help. Only the ad click ID is shared, "
    + "never your name or contact details.";

/*
 * The analytics consent bar, and page-view tracking once it is accepted.
 * Declining is as easy as accepting, either choice is remembered, and the
 * footer's "Analytics preferences" brings this back. The privacy policy's
 * "Analytics" section explains what is collected.
 *
 * Visitors who arrived from a Google ad also see a separate, unticked
 * ad-measurement box (docs/google-ads.md); analytics alone never reaches Google.
 * The box also shows, ticked, when reopened by someone who allowed it, so it
 * can be withdrawn. A visitor who allowed analytics earlier and now arrives
 * from an ad is asked about this ad visit alone.
 */
export function AnalyticsConsent() {
    const { pathname } = useLocation();
    const [consent, setConsentState] = useState(getConsent);
    const fromAd = cameFromAd();
    // Pre-ticked only when reopened to change an earlier yes.
    const [ads, setAds] = useState(() => !fromAd && getAdsConsent());
    const [adsAsked, setAdsAsked] = useState(adsAskedThisVisit);
    const showAdsBox = fromAd || getAdsConsent();

    useEffect(() => onConsentChange(setConsentState), []);

    useEffect(() => {
        if (consent !== "granted" || pathname.startsWith("/admin")) return;
        track("page_view", { path: pathname });
        void identify();
    }, [consent, pathname]);

    // Admin pages are the team's own visits: not tracked, and not asked about.
    if (pathname.startsWith("/admin")) return null;

    const answerAds = (granted: boolean) => { setAdsConsent(granted); setAdsAsked(true); };

    if (consent === "granted" && fromAd && !adsAsked) {
        return (
            <div role="region" aria-label="Ad measurement consent"
                className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
                <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
                    <p className="flex-1 text-sm text-muted-foreground">{ADS_TEXT} <Link to="/privacy-policy" className="underline">Privacy policy</Link></p>
                    <div className="flex shrink-0 gap-2">
                        <Button variant="outline" size="sm" onClick={() => answerAds(false)}>No thanks</Button>
                        <Button size="sm" onClick={() => answerAds(true)}>Allow</Button>
                    </div>
                </div>
            </div>
        );
    }
    if (consent !== null) return null;

    const allow = () => {
        // Before analytics, so a new visitor's first batch carries the choice.
        if (showAdsBox) answerAds(ads);
        setConsent("granted");
    };

    return (
        <div role="region" aria-label="Analytics consent"
            className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 px-4 py-3 shadow-lg backdrop-blur">
            <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex-1 space-y-2">
                    <p className="text-sm text-muted-foreground">
                        May we record which pages you visit here, so we can see what people look for and improve the shop?
                        If you sign in or send us an enquiry, these visits are linked to you so we can help better.
                        It stays with ProtoDesign and is not used for ads. You can change your mind from the footer. <Link to="/privacy-policy" className="underline">Privacy policy</Link>
                    </p>
                    {showAdsBox && (
                        <div className="flex items-start gap-2">
                            <Checkbox id="ads-measurement" checked={ads} onCheckedChange={(v) => setAds(v === true)} className="mt-0.5" />
                            <Label htmlFor="ads-measurement" className="text-xs font-normal leading-relaxed text-muted-foreground">{ADS_TEXT}</Label>
                        </div>
                    )}
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button variant="outline" size="sm" onClick={() => setConsent("denied")}>No thanks</Button>
                    <Button size="sm" onClick={allow}>Allow</Button>
                </div>
            </div>
        </div>
    );
}
