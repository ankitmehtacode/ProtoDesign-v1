import { FaWhatsapp } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Pieces shared by the printer advisor and the filament calculator. */

/** One question answered by tapping a pill. A radio group underneath, for keyboards and screen readers. */
export function Choice<T extends string>({ label, name, value, onChange, options }: {
    label: string;
    name: string;
    value: T | null;
    onChange: (v: T) => void;
    options: { value: T; label: string }[];
}) {
    return (
        <fieldset>
            <legend className="mb-2 font-semibold">{label}</legend>
            <div role="radiogroup" className="flex flex-wrap gap-2">
                {options.map((o) => (
                    <label key={o.value} className={cn(
                        "cursor-pointer rounded-full border px-4 py-2 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                        value === o.value ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground/80 hover:text-foreground",
                    )}>
                        <input type="radio" name={name} value={o.value} checked={value === o.value}
                            onChange={() => onChange(o.value)} className="sr-only" />
                        {o.label}
                    </label>
                ))}
            </div>
        </fieldset>
    );
}

/**
 * Opens WhatsApp with the result's code typed in. Sending it is the visitor's
 * choice; the shop's bot then replies with the result. Shown only when the
 * server returned a link, i.e. WhatsApp is on.
 */
export function SendToWhatsApp({ url, what }: { url: string | null; what: string }) {
    if (!url) return null;
    return (
        <div className="rounded-xl border bg-card p-5">
            <p className="font-semibold">Keep this on your phone</p>
            <p className="mt-1 text-sm text-muted-foreground">
                Send it to our WhatsApp and we will reply with your {what}. Ask us anything there too.
            </p>
            <Button asChild className="mt-3">
                <a href={url} target="_blank" rel="noopener noreferrer">
                    <FaWhatsapp className="mr-2 h-4 w-4" /> Send to my WhatsApp
                </a>
            </Button>
        </div>
    );
}
