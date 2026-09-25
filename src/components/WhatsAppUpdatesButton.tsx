import { useState } from "react";
import { FaWhatsapp } from "react-icons/fa";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { apiService } from "@/services/api.service";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";

interface Props {
    kind: "order" | "quote";
    id: string;
    size?: ButtonProps["size"];
    className?: string;
}

/**
 * Opens WhatsApp with a pre-filled message that links this order/quote to the
 * customer's chat. Sending that message is the customer's opt-in; nothing is
 * sent on their behalf. Renders nothing when WhatsApp is off.
 */
export function WhatsAppUpdatesButton({ kind, id, size = "sm", className }: Props) {
    const { data } = useWhatsAppStatus();
    const [opening, setOpening] = useState(false);
    if (!data?.enabled) return null;

    const open = async () => {
        // Open the tab synchronously, inside the click, so popup blockers allow
        // it; point it at WhatsApp once the signed link arrives.
        const tab = window.open("about:blank", "_blank");
        setOpening(true);
        try {
            const url = await apiService.getWhatsAppLink(kind, id);
            if (tab) {
                tab.opener = null;
                tab.location.href = url;
            } else {
                window.location.href = url;
            }
        } catch (error) {
            tab?.close();
            toast.error(error instanceof Error ? error.message : "Could not open WhatsApp. Please try again.");
        } finally {
            setOpening(false);
        }
    };

    return (
        <Button type="button" variant="outline" size={size} onClick={open} disabled={opening} className={className}>
            {opening ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FaWhatsapp className="w-4 h-4 mr-2 text-[#25D366]" />}
            Get updates on WhatsApp
        </Button>
    );
}
