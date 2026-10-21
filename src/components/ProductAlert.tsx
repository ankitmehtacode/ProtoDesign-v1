import { useState, type FormEvent } from "react";
import { BellRing, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiService } from "@/services/api.service";
import { flushAndWait, visitorId } from "@/lib/analytics";

/*
 * "Email me when it is back in stock / if the price drops", on product pages.
 * Double opt-in: the alert starts once the emailed link is confirmed.
 * Sent by email because these fire days later, outside WhatsApp's free window
 * (backend/src/services/product-alerts.service.js).
 */

// Must match CONSENT_TEXTS['product-alert-v1'] in backend/src/services/leads.service.js.
const CONSENT_VERSION = "product-alert-v1";
const CONSENT_TEXT = "I agree that ProtoDesign may email me about this product, and contact me about it. "
    + "Every email has an unsubscribe link, and I can ask for my details to be deleted at any time.";

export function ProductAlert({ productId, inStock }: { productId: string; inStock: boolean }) {
    const kind = inStock ? "price_drop" : "back_in_stock";
    const [email, setEmail] = useState("");
    const [website, setWebsite] = useState(""); // honeypot
    const [consent, setConsent] = useState(false);
    const [sending, setSending] = useState(false);
    const [done, setDone] = useState(false);

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!consent) { toast.error("Please tick the box so we may email you."); return; }
        setSending(true);
        try {
            await flushAndWait(); // the views that led here are stored before the sign-up
            await apiService.request("/alerts", {
                method: "POST",
                skipAuth: !apiService.isAuthenticated(),
                body: JSON.stringify({ productId, kind, email, website, consent, consentVersion: CONSENT_VERSION, visitorId: visitorId() ?? undefined }),
            });
            setDone(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not set the alert. Please try again.");
        } finally {
            setSending(false);
        }
    };

    if (done) {
        return (
            <p className="flex items-center gap-2 rounded-lg border p-4 text-sm">
                <Check className="h-4 w-4 text-green-300" />
                Almost done: we have emailed you a link. Confirm it and we will email you {inStock ? "if the price drops" : "when it is back in stock"}.
            </p>
        );
    }

    return (
        <form onSubmit={submit} className="rounded-lg border p-4">
            <p className="flex items-center gap-2 font-medium">
                <BellRing className="h-4 w-4" /> {inStock ? "Waiting for a better price?" : "Out of stock for now"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
                {inStock ? "We will email you once if the price drops." : "We will email you once when it is back."}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Label htmlFor={`alert-email-${productId}`} className="sr-only">Email</Label>
                <Input id={`alert-email-${productId}`} type="email" required autoComplete="email" placeholder="you@example.com"
                    value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
                <Button type="submit" variant="outline" disabled={sending} className="shrink-0">
                    {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Email me
                </Button>
            </div>
            <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)}
                tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
            <div className="mt-3 flex items-start gap-2">
                <Checkbox id={`alert-consent-${productId}`} checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                <Label htmlFor={`alert-consent-${productId}`} className="text-xs font-normal leading-relaxed text-muted-foreground">{CONSENT_TEXT}</Label>
            </div>
        </form>
    );
}
