import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FaWhatsapp } from "react-icons/fa";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiService } from "@/services/api.service";

interface Conversation {
    id: string;
    wa_id: string;
    profile_name: string | null;
    opted_out_at: string | null;
    window_open: boolean;
    last_direction: "inbound" | "outbound";
    last_body: string | null;
    last_type: string;
    last_status: string;
    last_at: string;
    links: { order_id: string | null; quote_id: string | null }[] | null;
}

interface Message {
    id: string;
    direction: "inbound" | "outbound";
    message_type: string;
    kind: string;
    body: string | null;
    status: string;
    error_code: string | null;
    error_message: string | null;
    billable: boolean;
    created_at: string;
}

const short = (id: string) => id.slice(0, 8).toUpperCase();
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS_STYLE: Record<string, string> = {
    failed: "text-red-600",
    skipped: "text-amber-600",
    read: "text-green-600",
    delivered: "text-green-600",
};

/**
 * WhatsApp status for the shop: whether it is on, what it has cost, recent
 * conversations and failures, and replies within the free 24-hour window.
 */
export function WhatsAppPanel() {
    const [openId, setOpenId] = useState<string | null>(null);
    const { data, isLoading, refetch, isFetching } = useQuery({
        queryKey: ["whatsapp-overview"],
        queryFn: () => apiService.getWhatsAppOverview(),
        retry: false,
    });

    if (isLoading) return null;
    if (!data) return null;
    const { config, stats, conversations, failed } = data as {
        config: { mode: string; enabled: boolean; missing: string[]; paidTemplates: boolean; businessNumber: string | null };
        stats: { contacts: number; opted_out: number; billable_30d: number; failed_7d: number; skipped_window_30d: number };
        conversations: Conversation[];
        failed: { id: string; wa_id: string; order_id: string | null; quote_id: string | null; error_code: string; error_message: string; created_at: string }[];
    };

    return (
        <Card className="mt-8">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2">
                        <FaWhatsapp className="text-[#25D366]" /> WhatsApp
                        <Badge variant={config.enabled ? "default" : "secondary"} className="capitalize">
                            {config.enabled ? config.mode : "off"}
                        </Badge>
                        {config.enabled && (
                            <Badge variant="outline">{config.paidTemplates ? "Paid templates on" : "Free-only"}</Badge>
                        )}
                    </CardTitle>
                    <CardDescription>
                        {config.missing.length > 0
                            ? `Not configured: ${config.missing.join(", ")}`
                            : config.enabled
                                ? `Customers message +${config.businessNumber}. Replies are free within 24 hours of their last message.`
                                : "Set WHATSAPP_MODE to turn WhatsApp on (see docs/whatsapp-integration.md)."}
                    </CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isFetching} aria-label="Refresh WhatsApp">
                    <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
                </Button>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                    {[
                        ["Contacts", stats.contacts],
                        ["Opted out", stats.opted_out],
                        ["Billable (30d)", stats.billable_30d],
                        ["Not sent, window closed (30d)", stats.skipped_window_30d],
                        ["Failed (7d)", stats.failed_7d],
                    ].map(([label, value]) => (
                        <div key={label as string} className="rounded-lg border p-3">
                            <div className="text-muted-foreground text-xs">{label}</div>
                            <div className="text-xl font-semibold">{value}</div>
                        </div>
                    ))}
                </div>

                <div>
                    <h4 className="font-medium mb-2">Recent conversations</h4>
                    {conversations.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No WhatsApp conversations yet.</p>
                    ) : (
                        <div className="divide-y rounded-lg border">
                            {conversations.map((c) => (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => setOpenId(c.id)}
                                    className="w-full text-left p-3 hover:bg-muted/50 flex items-center justify-between gap-4"
                                >
                                    <div className="min-w-0">
                                        <div className="font-medium flex items-center gap-2">
                                            {c.profile_name || `+${c.wa_id}`}
                                            {c.window_open && <Badge variant="outline" className="text-green-700 border-green-300">Can reply</Badge>}
                                            {c.opted_out_at && <Badge variant="secondary">Opted out</Badge>}
                                        </div>
                                        <div className="text-sm text-muted-foreground truncate">
                                            {c.last_direction === "outbound" ? "You: " : ""}
                                            {c.last_body || `[${c.last_type}]`}
                                        </div>
                                        {c.links && c.links.length > 0 && (
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {c.links.map((l) => (l.order_id ? `Order #${short(l.order_id)}` : `Quote #${short(l.quote_id!)}`)).join(" · ")}
                                            </div>
                                        )}
                                    </div>
                                    <div className="text-xs text-muted-foreground whitespace-nowrap">{when(c.last_at)}</div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {failed.length > 0 && (
                    <div>
                        <h4 className="font-medium mb-2">Failed messages</h4>
                        <ul className="text-sm space-y-1">
                            {failed.map((f) => (
                                <li key={f.id} className="flex flex-wrap gap-x-3 text-muted-foreground">
                                    <span>{when(f.created_at)}</span>
                                    <span>+{f.wa_id}</span>
                                    {f.order_id && <span>Order #{short(f.order_id)}</span>}
                                    {f.quote_id && <span>Quote #{short(f.quote_id)}</span>}
                                    <span className="text-red-600">{f.error_code}: {f.error_message}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </CardContent>

            {openId && <ConversationDialog contactId={openId} onClose={() => setOpenId(null)} />}
        </Card>
    );
}

function ConversationDialog({ contactId, onClose }: { contactId: string; onClose: () => void }) {
    const queryClient = useQueryClient();
    const [text, setText] = useState("");
    const [sending, setSending] = useState(false);
    const { data, isLoading } = useQuery({
        queryKey: ["whatsapp-messages", contactId],
        queryFn: () => apiService.getWhatsAppMessages(contactId),
        refetchInterval: 10_000,
    });
    const contact = data?.contact;
    const messages: Message[] = data?.messages ?? [];

    const send = async () => {
        setSending(true);
        try {
            await apiService.sendWhatsAppReply(contactId, text.trim());
            setText("");
            await queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", contactId] });
            await queryClient.invalidateQueries({ queryKey: ["whatsapp-overview"] });
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Reply failed");
        } finally {
            setSending(false);
        }
    };

    return (
        <Dialog open onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>{contact ? contact.profile_name || `+${contact.wa_id}` : "Conversation"}</DialogTitle>
                    {contact && <p className="text-sm text-muted-foreground">+{contact.wa_id}</p>}
                </DialogHeader>
                {isLoading ? (
                    <div className="py-8 flex justify-center"><Loader2 className="animate-spin" /></div>
                ) : (
                    <div className="max-h-80 overflow-y-auto space-y-2 pr-1">
                        {messages.map((m) => (
                            <div key={m.id} className={`flex ${m.direction === "outbound" ? "justify-end" : "justify-start"}`}>
                                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.direction === "outbound" ? "bg-primary/10" : "bg-muted"}`}>
                                    <div className="whitespace-pre-wrap break-words">{m.body ?? <span className="italic text-muted-foreground">[{m.message_type}]</span>}</div>
                                    <div className="text-[11px] text-muted-foreground mt-1 flex gap-2">
                                        <span>{when(m.created_at)}</span>
                                        {m.direction === "outbound" && (
                                            <span className={STATUS_STYLE[m.status] || ""} title={m.error_message || undefined}>
                                                {m.status}{m.error_code ? ` (${m.error_code})` : ""}{m.billable ? " · billed" : ""}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {contact?.window_open ? (
                    <div className="space-y-2">
                        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply on WhatsApp..." maxLength={4096} rows={3} />
                        <Button onClick={send} disabled={sending || !text.trim()} className="w-full">
                            {sending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
                            Send
                        </Button>
                    </div>
                ) : contact ? (
                    <p className="text-sm text-muted-foreground">
                        More than 24 hours since their last message, so WhatsApp only allows a paid template. Reply by email or phone instead.
                    </p>
                ) : null}
            </DialogContent>
        </Dialog>
    );
}
