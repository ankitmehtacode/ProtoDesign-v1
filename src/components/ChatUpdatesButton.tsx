import { useState } from "react";
import { FaTelegramPlane, FaWhatsapp } from "react-icons/fa";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";
import { apiService } from "@/services/api.service";
import { useTelegramStatus, useWhatsAppStatus } from "@/hooks/use-whatsapp-status";

type Channel = "whatsapp" | "telegram";

const CHANNELS = {
    whatsapp: { name: "WhatsApp", Icon: FaWhatsapp, color: "text-[#25D366]", useStatus: useWhatsAppStatus, getLink: apiService.getWhatsAppLink.bind(apiService) },
    telegram: { name: "Telegram", Icon: FaTelegramPlane, color: "text-[#26A5E4]", useStatus: useTelegramStatus, getLink: apiService.getTelegramLink.bind(apiService) },
} as const;

interface Props {
    channel: Channel;
    kind: "order" | "quote";
    id: string;
    size?: ButtonProps["size"];
    className?: string;
}

/**
 * Opens the customer's own WhatsApp or Telegram with a signed link that ties
 * this order/quote to their chat. Sending that message (WhatsApp) or pressing
 * Start (Telegram) is the customer's opt-in; nothing is sent on their behalf.
 * Renders nothing when that channel is off.
 */
export function ChatUpdatesButton({ channel, kind, id, size = "sm", className }: Props) {
    const { name, Icon, color, useStatus, getLink } = CHANNELS[channel];
    const { data } = useStatus();
    const [opening, setOpening] = useState(false);
    if (!data?.enabled) return null;

    const open = async () => {
        // Open the tab synchronously, inside the click, so popup blockers allow
        // it; point it at the chat once the signed link arrives.
        const tab = window.open("about:blank", "_blank");
        setOpening(true);
        try {
            const url = await getLink(kind, id);
            if (tab) {
                tab.opener = null;
                tab.location.href = url;
            } else {
                window.location.href = url;
            }
        } catch (error) {
            tab?.close();
            toast.error(error instanceof Error ? error.message : `Could not open ${name}. Please try again.`);
        } finally {
            setOpening(false);
        }
    };

    return (
        <Button type="button" variant="outline" size={size} onClick={open} disabled={opening} className={className}>
            {opening ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Icon className={`w-4 h-4 mr-2 ${color}`} />}
            Get updates on {name}
        </Button>
    );
}
