import { useQuery } from "@tanstack/react-query";
import { apiService } from "@/services/api.service";

/** Whether WhatsApp is switched on server-side. Cached for the session. */
export function useWhatsAppStatus() {
    return useQuery({
        queryKey: ["whatsapp-status"],
        queryFn: () => apiService.getWhatsAppStatus(),
        staleTime: Infinity,
        retry: false,
    });
}

/** Whether the Telegram bot is switched on server-side. Cached for the session. */
export function useTelegramStatus() {
    return useQuery({
        queryKey: ["telegram-status"],
        queryFn: () => apiService.getTelegramStatus(),
        staleTime: Infinity,
        retry: false,
    });
}
