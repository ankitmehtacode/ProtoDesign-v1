import { useState, type FormEvent } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { apiService } from "@/services/api.service";
import { flushAndWait, visitorId } from "@/lib/analytics";

/*
 * "Ask an expert": a short enquiry form on printer, filament and resin pages.
 * It is how an anonymous visitor becomes a lead the team can call back.
 */

export type LeadInterest = "printer" | "filament" | "resin";

export const INTEREST_FOR_CATEGORY: Record<string, LeadInterest> = {
    "3d_printer": "printer",
    filament: "filament",
    resin: "resin",
};

// Must match CONSENT_TEXTS[CONSENT_VERSION] in backend/src/services/leads.service.js,
// which is what gets stored. Change both together, under a new version.
const CONSENT_VERSION = "lead-contact-v1";
const CONSENT_TEXT = "I agree that ProtoDesign may contact me on WhatsApp, phone or email about this enquiry. "
    + "I can ask for my details to be deleted at any time.";
// Optional and separate (docs/google-ads.md). Must match
// ADS_CONSENT_TEXTS['lead-ads-v1'] in the same backend file.
const ADS_CONSENT_VERSION = "lead-ads-v1";
const ADS_CONSENT_TEXT = "Also show me ProtoDesign offers in Google ads. ProtoDesign may share my phone number and email "
    + "with Google in scrambled (hashed) form for this. I can withdraw at any time.";

const COPY: Record<LeadInterest, { title: string; body: string; placeholder: string }> = {
    printer: {
        title: "Not sure which printer is right?",
        body: "Tell us what you want to print. We will reply on WhatsApp with a recommendation and our best price.",
        placeholder: "e.g. functional parts in PETG, budget around ₹40,000",
    },
    filament: {
        title: "Need help choosing filament, or buying in bulk?",
        body: "Tell us your printer and what you are making. We will suggest a material and quote for bulk spools.",
        placeholder: "e.g. Bambu A1, outdoor parts, 5 kg a month",
    },
    resin: {
        title: "Need help choosing a resin?",
        body: "Tell us your printer and what the part has to do. We will suggest a resin and how to cure it.",
        placeholder: "e.g. miniatures on a Saturn 4, need fine detail",
    },
};

export function LeadCapture({ interest, form, productId, productName }: {
    interest: LeadInterest;
    form: string;
    productId?: string;
    productName?: string;
}) {
    const [name, setName] = useState("");
    const [phone, setPhone] = useState("");
    const [message, setMessage] = useState("");
    const [website, setWebsite] = useState(""); // honeypot, hidden from people
    const [consent, setConsent] = useState(false);
    const [adsConsent, setAdsConsent] = useState(false);
    const [sending, setSending] = useState(false);
    const [sent, setSent] = useState(false);
    const copy = COPY[interest];

    const submit = async (e: FormEvent) => {
        e.preventDefault();
        if (!consent) { toast.error("Please tick the box so we may contact you."); return; }
        setSending(true);
        try {
            await flushAndWait(); // the views that led here are stored before the enquiry
            await apiService.request("/leads", {
                method: "POST",
                skipAuth: !apiService.isAuthenticated(),
                body: JSON.stringify({
                    name, phone, message, website, interest, form, productId,
                    consent, consentVersion: CONSENT_VERSION,
                    ...(adsConsent ? { adsConsent: true, adsConsentVersion: ADS_CONSENT_VERSION } : {}),
                    visitorId: visitorId() ?? undefined,
                }),
            });
            setSent(true);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not send. Please try again.");
        } finally {
            setSending(false);
        }
    };

    if (sent) {
        return (
            <section className="rounded-xl border bg-card p-6">
                <p className="flex items-center gap-2 font-semibold"><Check className="h-5 w-5 text-green-300" /> Thanks, we have your details.</p>
                <p className="mt-1 text-sm text-muted-foreground">Someone from ProtoDesign will message you on WhatsApp, usually within a working day.</p>
            </section>
        );
    }

    return (
        <section className="rounded-xl border bg-card p-6" aria-labelledby={`lead-${form}`}>
            <h2 id={`lead-${form}`} className="font-display text-xl font-bold">{copy.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
                {productName ? `Asking about ${productName}. ` : ""}{copy.body}
            </p>
            <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                    <Label htmlFor={`lead-name-${form}`}>Name</Label>
                    <Input id={`lead-name-${form}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
                </div>
                <div className="grid gap-1.5">
                    <Label htmlFor={`lead-phone-${form}`}>WhatsApp number</Label>
                    <Input id={`lead-phone-${form}`} value={phone} onChange={(e) => setPhone(e.target.value)} required
                        inputMode="tel" autoComplete="tel" placeholder="98765 43210" maxLength={20} />
                </div>
                <div className="grid gap-1.5 sm:col-span-2">
                    <Label htmlFor={`lead-msg-${form}`}>What do you need? <span className="text-muted-foreground">(optional)</span></Label>
                    <Textarea id={`lead-msg-${form}`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={1000}
                        rows={2} placeholder={copy.placeholder} />
                </div>
                <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)}
                    tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
                <div className="flex items-start gap-2 sm:col-span-2">
                    <Checkbox id={`lead-consent-${form}`} checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                    <Label htmlFor={`lead-consent-${form}`} className="text-xs font-normal leading-relaxed text-muted-foreground">{CONSENT_TEXT}</Label>
                </div>
                <div className="flex items-start gap-2 sm:col-span-2">
                    <Checkbox id={`lead-ads-${form}`} checked={adsConsent} onCheckedChange={(v) => setAdsConsent(v === true)} className="mt-0.5" />
                    <Label htmlFor={`lead-ads-${form}`} className="text-xs font-normal leading-relaxed text-muted-foreground">{ADS_CONSENT_TEXT} (Optional.)</Label>
                </div>
                <Button type="submit" disabled={sending} className="sm:col-span-2 sm:justify-self-start">
                    {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Ask an expert
                </Button>
            </form>
        </section>
    );
}
