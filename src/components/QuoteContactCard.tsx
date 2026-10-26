import { forwardRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Clock, Loader2, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/currency";
import { emailSuggestion, type ContactErrors } from "@/lib/quote";

/*
 * The last step of the quote page: where to send the quote. Nothing is uploaded
 * until the visitor gives an email and WhatsApp number (the server refuses a
 * guest upload without them), so this card has to earn those two fields.
 *
 * It asks once the visitor has seen their model and price, frames the ask as
 * the final step of three, keeps the form to two fields with no account or
 * password, and says plainly what happens next.
 */

export type QuoteContact = { email: string; phone: string; notes: string; website: string };
const STEPS = ["Model checked", "Price ready", "Send it to you"];

interface Props {
    price: number;
    printTime: string;
    summary: string;
    contact: QuoteContact;
    onContactChange: (next: Partial<QuoteContact>) => void;
    errors: ContactErrors;
    onSubmit: () => void;
    sending: boolean;
    uploadProgress: number | null;
    hasFile: boolean;
}

export const QuoteContactCard = forwardRef<HTMLFormElement, Props>(function QuoteContactCard(
    { price, printTime, summary, contact, onContactChange, errors, onSubmit, sending, uploadProgress, hasFile },
    ref,
) {
    const [showNotes, setShowNotes] = useState(Boolean(contact.notes));
    const suggestion = emailSuggestion(contact.email);
    // A number typed with its own country code does not get the +91 hint.
    const intl = contact.phone.trim().startsWith("+");

    const submit = (e: FormEvent) => {
        e.preventDefault();
        onSubmit();
    };

    const buttonText = uploadProgress !== null && uploadProgress < 1
        ? `Uploading model... ${Math.round(uploadProgress * 100)}%`
        : sending
            ? "Sending your quote..."
            : hasFile ? "Get my exact quote" : "Upload a model to start";

    return (
        <form
            ref={ref}
            id="quote-contact"
            onSubmit={submit}
            noValidate
            className="relative scroll-mt-28 overflow-hidden rounded-2xl border border-primary/30 bg-card shadow-[0_0_0_1px_hsl(var(--primary)/0.08),0_20px_60px_-20px_hsl(var(--primary)/0.35)]"
        >
            {/* Goal gradient: two of three steps are already done for them. */}
            <ol className="grid grid-cols-3 border-b border-border/60 text-[11px] font-medium sm:text-xs">
                {STEPS.map((step, i) => {
                    const done = hasFile && i < 2;
                    const current = hasFile && i === 2;
                    return (
                        <li key={step} className={`flex items-center justify-center gap-1.5 px-2 py-2.5 ${current ? "bg-primary/10 text-primary" : done ? "text-foreground" : "text-muted-foreground"}`}>
                            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${done ? "bg-primary text-primary-foreground" : current ? "border border-primary" : "border border-border"}`}>
                                {done ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
                            </span>
                            <span className="truncate">{step}</span>
                        </li>
                    );
                })}
            </ol>

            <div className="space-y-5 p-5 sm:p-6">
                <div className="flex items-end justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-xs uppercase tracking-wider text-muted-foreground">Your estimate</p>
                        <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
                    </div>
                    <div className="text-right">
                        <p className="font-display text-3xl font-bold tabular-nums text-primary">{formatINR(price)}</p>
                        <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" /> {printTime} print
                        </p>
                    </div>
                </div>

                <div className="space-y-1">
                    <h2 className="font-display text-lg font-bold leading-snug">Where should we send your final quote?</h2>
                    <p className="text-sm text-muted-foreground">
                        Our team checks your file and replies with the confirmed price and a payment link.
                    </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                        <Label htmlFor="quote-email">Email</Label>
                        <Input
                            id="quote-email" type="email" inputMode="email" autoComplete="email" maxLength={254}
                            placeholder="you@gmail.com" value={contact.email}
                            onChange={(e) => onContactChange({ email: e.target.value })}
                            aria-invalid={Boolean(errors.email)} aria-describedby="quote-email-hint"
                            className={`h-11 ${errors.email ? "border-destructive focus-visible:ring-destructive" : ""}`}
                        />
                        <p id="quote-email-hint" className="min-h-4 text-xs" aria-live="polite">
                            {suggestion ? (
                                <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => onContactChange({ email: suggestion })}>
                                    Did you mean <strong>{suggestion}</strong>?
                                </button>
                            ) : errors.email ? <span className="text-destructive">{errors.email}</span> : null}
                        </p>
                    </div>
                    <div className="grid gap-1.5">
                        <Label htmlFor="quote-phone">WhatsApp number</Label>
                        <div className="relative">
                            {!intl && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">+91</span>}
                            <Input
                                id="quote-phone" type="tel" inputMode="tel" autoComplete="tel-national" maxLength={20}
                                placeholder="98765 43210" value={contact.phone}
                                onChange={(e) => onContactChange({ phone: e.target.value })}
                                aria-invalid={Boolean(errors.phone)} aria-describedby="quote-phone-hint"
                                className={`h-11 ${intl ? "" : "pl-11"} ${errors.phone ? "border-destructive focus-visible:ring-destructive" : ""}`}
                            />
                        </div>
                        <p id="quote-phone-hint" className="min-h-4 text-xs" aria-live="polite">
                            {errors.phone ? <span className="text-destructive">{errors.phone}</span> : <span className="text-muted-foreground">Outside India? Include your country code.</span>}
                        </p>
                    </div>
                </div>

                {showNotes ? (
                    <Textarea
                        autoFocus maxLength={1000} rows={2} value={contact.notes}
                        placeholder="Anything we should know? e.g. needs to fit a 20 mm shaft"
                        onChange={(e) => onContactChange({ notes: e.target.value })}
                    />
                ) : (
                    <button type="button" onClick={() => setShowNotes(true)} className="-mt-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                        <Plus className="h-3.5 w-3.5" /> Add instructions (optional)
                    </button>
                )}

                {/* Honeypot: hidden from people, filled by bots. */}
                <input type="text" name="website" value={contact.website} onChange={(e) => onContactChange({ website: e.target.value })}
                    tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />

                <Button
                    type="submit" size="lg" disabled={sending || !hasFile}
                    className="group h-14 w-full rounded-xl text-base font-semibold shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]"
                >
                    {sending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                    {buttonText}
                    {!sending && hasFile && <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />}
                </Button>

                <ul className="grid gap-1.5 text-xs text-muted-foreground sm:grid-cols-3">
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> No payment now</li>
                    <li className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> No account or password</li>
                    <li className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 text-primary" /> Your design stays private</li>
                </ul>
                <p className="border-t border-border/60 pt-4 text-xs text-muted-foreground">
                    We use these details only to reply about this quote, usually within a working day.
                </p>
            </div>
        </form>
    );
});
