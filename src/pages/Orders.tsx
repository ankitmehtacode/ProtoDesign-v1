import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    Card,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Loader2,
    Calendar as CalendarIcon,
    ChevronRight,
    MapPin,
    User,
    Package,
    Phone,
    Mail,
    Edit2
} from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { motion } from "framer-motion";
import { WhatsAppUpdatesButton } from "@/components/WhatsAppUpdatesButton";

// --- TYPES ---
interface OrderItem {
    product_id: string;
    quantity: number;
    line_total: number;
    product_name?: string;
    product_price?: number;
    product_image?: string;
}

interface ShippingAddress {
    fullName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
}

interface Order {
    id: string;
    total_amount: number;
    tax_amount?: number;       // ✅ Add this
    shipping_amount?: number;
    status: string;
    created_at: string;
    items: OrderItem[];
    shipping_address: ShippingAddress;
    total_quantity?: number;
}

// Status Config
const STATUS_COLORS: Record<string, string> = {
    pending: "bg-gray-500",
    pending_payment: "bg-yellow-500",
    processing: "bg-blue-500",
    shipped: "bg-purple-500",
    delivered: "bg-green-500",
    completed: "bg-green-600",
    cancelled: "bg-red-500",
};

const STATUS_LABELS: Record<string, string> = {
    pending: "Pending",
    pending_payment: "Pending Payment",
    processing: "Processing",
    shipped: "Shipped",
    delivered: "Delivered",
    completed: "Completed",
    cancelled: "Cancelled",
};

export default function Orders() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [orders, setOrders] = useState<Order[]>([]);
    const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

    // Filter State
    const [dateFilter, setDateFilter] = useState("all");
    const [startDate, setStartDate] = useState("");
    const [endDate, setEndDate] = useState("");

    // Edit Address State
    const [isEditingAddress, setIsEditingAddress] = useState(false);
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    const [newAddress, setNewAddress] = useState<ShippingAddress>({
        fullName: "", email: "", phone: "", address: "", city: "", state: "", pincode: "", country: "India"
    });

    useEffect(() => {
        fetchOrders();
    }, []);

    const fetchOrders = async () => {
        try {
            if (!apiService.isAuthenticated()) { navigate("/auth"); return; }
            setLoading(true);

            const res = await apiService.getOrders();
            // The backend now returns the perfect structure, no mapping needed!
            const rawOrders = Array.isArray(res) ? res : (res.data || []);


            // Just calculate total_quantity if missing
            const finalOrders = rawOrders.map((o: any) => ({
                ...o,
                total_quantity: o.items.reduce((sum: number, i: any) => sum + i.quantity, 0)
            }));

            setOrders(finalOrders);
        } catch (error: any) {
            console.error("Fetch orders error:", error);
            if (error.message?.includes('401')) {
                navigate('/auth');
            } else {
                toast.error("Failed to load orders");
            }
        } finally {
            setLoading(false);
        }
    };

    // --- ACTIONS ---

    const handleCancelOrder = async (orderId: string) => {
        if (!confirm("Are you sure you want to cancel this order? This action cannot be undone.")) return;
        try {
            await apiService.cancelOrder(orderId);
            toast.success("Order cancelled successfully");
            fetchOrders();
        } catch (error: any) {
            toast.error(error.message || "Failed to cancel order");
        }
    };

    const startEditAddress = (order: Order, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent toggling accordion
        setEditingOrder(order);
        setNewAddress(order.shipping_address || { fullName: "", email: "", phone: "", address: "", city: "", state: "", pincode: "", country: "India" });
        setIsEditingAddress(true);
    };

    const saveAddress = async () => {
        if (!editingOrder) return;
        try {
            await apiService.updateOrderAddress(editingOrder.id, newAddress);
            toast.success("Address updated successfully");
            setIsEditingAddress(false);
            fetchOrders();
        } catch (error: any) {
            toast.error(error.message || "Failed to update address");
        }
    };

    // --- HELPERS ---
    const isEditable = (status: string) => ['pending', 'pending_payment', 'processing'].includes(status);

    const getFilteredOrders = () => {
        if (dateFilter === "all") return orders;
        const now = new Date();
        return orders.filter(order => {
            const date = new Date(order.created_at);
            switch (dateFilter) {
                case "last_day": return date.getTime() >= now.getTime() - 86400000;
                case "last_week": return date.getTime() >= now.getTime() - 604800000;
                case "last_month": return date.getTime() >= now.getTime() - 2592000000;
                case "last_year": return date.getTime() >= now.getTime() - 31536000000;
                case "date":
                    if (!startDate) return true;
                    return date.toDateString() === new Date(startDate).toDateString();
                case "range":
                    if (!startDate || !endDate) return true;
                    const start = new Date(startDate);
                    const end = new Date(endDate);
                    end.setHours(23, 59, 59);
                    return date >= start && date <= end;
                default: return true;
            }
        });
    };

    const filteredOrders = getFilteredOrders();

    if (loading) return <div className="min-h-screen pt-32 flex justify-center"><Loader2 className="animate-spin w-8 h-8 text-primary" /></div>;

    return (
        <div className="min-h-screen pt-20 pb-16 bg-background/50">

            {/* HERO SECTION */}
            <section className="py-12 mb-8 bg-background border-b">
                <div className="container mx-auto px-4">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="max-w-4xl mx-auto"
                    >
                        <h1 className="font-display text-4xl font-bold mb-4">Order History</h1>
                        <p className="text-muted-foreground text-lg">Track your shipments and manage your recent purchases.</p>

                        {/* FILTERS */}
                        <div className="flex flex-wrap items-center gap-3 mt-8">
                            <Select value={dateFilter} onValueChange={setDateFilter}>
                                <SelectTrigger className="w-[150px] bg-background">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    <SelectValue placeholder="Filter Date" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Time</SelectItem>
                                    <SelectItem value="last_day">Last 24 Hours</SelectItem>
                                    <SelectItem value="last_week">Last 7 Days</SelectItem>
                                    <SelectItem value="last_month">Last 30 Days</SelectItem>
                                    <SelectItem value="last_year">Last Year</SelectItem>
                                    <SelectItem value="date">Specific Date</SelectItem>
                                    <SelectItem value="range">Date Range</SelectItem>
                                </SelectContent>
                            </Select>

                            {dateFilter === 'date' && (
                                <Input type="date" className="w-auto bg-background" value={startDate} onChange={e => setStartDate(e.target.value)} />
                            )}
                            {dateFilter === 'range' && (
                                <div className="flex items-center gap-2 bg-background p-1 rounded-md border">
                                    <Input type="date" className="border-0 shadow-none focus-visible:ring-0 w-32" value={startDate} onChange={e => setStartDate(e.target.value)} />
                                    <span className="text-muted-foreground">-</span>
                                    <Input type="date" className="border-0 shadow-none focus-visible:ring-0 w-32" value={endDate} onChange={e => setEndDate(e.target.value)} />
                                </div>
                            )}
                        </div>
                    </motion.div>
                </div>
            </section>

            <div className="container mx-auto px-4 max-w-4xl">
                {filteredOrders.length === 0 ? (
                    <div className="text-center py-16 bg-muted/10 rounded-2xl border border-dashed border-border/60">
                        <Package className="h-16 w-16 mx-auto text-muted-foreground mb-4 opacity-40" />
                        <h3 className="text-xl font-semibold mb-2">No orders found</h3>
                        <p className="text-muted-foreground mb-6">We couldn't find any orders matching your filters.</p>
                        <Button onClick={() => navigate("/shop")}>Browse Products</Button>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {filteredOrders.map(order => (
                            <Card key={order.id} className="overflow-hidden border-border/60 hover:shadow-md transition-all duration-200">
                                <div className="p-6">
                                    {/* ORDER HEADER */}
                                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                                        <div className="flex items-center gap-3">
                                            <div className="bg-primary/10 p-2 rounded-lg">
                                                <Package className="w-5 h-5 text-primary" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold font-mono tracking-tight">Order #{order.id.slice(0, 8).toUpperCase()}</h3>
                                                <div className="text-xs text-muted-foreground">
                                                    Placed on {new Date(order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                                            <Badge className={`${STATUS_COLORS[order.status]} text-white px-3 py-1 capitalize`}>
                                                {STATUS_LABELS[order.status] || order.status}
                                            </Badge>
                                            <div className="text-right">
                                                <span className="block font-bold text-lg">{formatINR(order.total_amount)}</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* EXPAND TOGGLE BAR */}
                                    <div className="flex justify-between items-center pt-4 border-t border-border/50">
                                        <div className="text-sm text-muted-foreground">
                                            {order.total_quantity} Item{order.total_quantity !== 1 && 's'}
                                        </div>
                                        <div className="flex items-center gap-2">
                                        {order.status !== 'cancelled' && <WhatsAppUpdatesButton kind="order" id={order.id} className="hidden sm:inline-flex" />}
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                                            className="text-primary hover:text-primary hover:bg-primary/5"
                                        >
                                            {expandedOrderId === order.id ? 'Hide Details' : 'View Details'}
                                            <ChevronRight className={`ml-1 w-4 h-4 transition-transform duration-200 ${expandedOrderId === order.id ? "rotate-90" : ""}`} />
                                        </Button>
                                        </div>
                                    </div>

                                    {/* EXPANDED CONTENT */}
                                    {expandedOrderId === order.id && (
                                        <div className="mt-6 pt-6 border-t border-border/50 animate-in slide-in-from-top-2 fade-in duration-300">
                                            {/* On phones the toggle bar is too narrow for this; show it here instead. */}
                                            {order.status !== 'cancelled' && <WhatsAppUpdatesButton kind="order" id={order.id} className="sm:hidden w-full mb-6" />}

                                            <div className="grid md:grid-cols-2 gap-8 mb-8">
                                                {/* CUSTOMER DETAILS */}
                                                <div className="space-y-3">
                                                    <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                                                        <User size={14} /> CUSTOMER
                                                    </h4>
                                                    <div className="bg-secondary/20 p-4 rounded-xl space-y-2 text-sm">
                                                        <p className="font-medium text-foreground">{order.shipping_address?.fullName || "Guest User"}</p>
                                                        <div className="flex items-center gap-2 text-muted-foreground">
                                                            <Mail size={12} /> {order.shipping_address?.email}
                                                        </div>
                                                        <div className="flex items-center gap-2 text-muted-foreground">
                                                            <Phone size={12} /> {order.shipping_address?.phone}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* SHIPPING DETAILS */}
                                                <div className="space-y-3">
                                                    <div className="flex justify-between items-center">
                                                        <h4 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
                                                            <MapPin size={14} /> SHIPPING ADDRESS
                                                        </h4>
                                                        {isEditable(order.status) && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-6 px-2 text-xs text-primary hover:text-primary hover:bg-primary/10"
                                                                onClick={(e) => startEditAddress(order, e)}
                                                            >
                                                                <Edit2 size={10} className="mr-1" /> Edit
                                                            </Button>
                                                        )}
                                                    </div>
                                                    <div className="bg-secondary/20 p-4 rounded-xl text-sm space-y-1">
                                                        <p className="leading-relaxed">{order.shipping_address?.address}</p>
                                                        <p className="text-muted-foreground">
                                                            {[order.shipping_address?.city, order.shipping_address?.state, order.shipping_address?.pincode].filter(Boolean).join(", ")}
                                                        </p>
                                                        <p className="text-muted-foreground">{order.shipping_address?.country}</p>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* ITEMS LIST */}
                                            <div className="space-y-3">
                                                <h4 className="text-sm font-semibold text-muted-foreground">ITEMS</h4>
                                                <div className="grid gap-3">
                                                    {order.items.map((item, idx) => (
                                                        <div key={idx} className="flex justify-between items-center p-3 bg-background border rounded-lg hover:border-primary/30 transition-colors">
                                                            {/* ... existing item render ... */}
                                                            <div className="flex items-center gap-4">
                                                                {/* ... image and name ... */}
                                                                <div className="h-12 w-12 rounded-md bg-muted overflow-hidden border">
                                                                    {item.product_image ? (
                                                                        <img src={item.product_image} alt="" className="w-full h-full object-cover" />
                                                                    ) : (
                                                                        <Package className="w-full h-full p-3 text-muted-foreground" />
                                                                    )}
                                                                </div>
                                                                <div>
                                                                    <p className="font-medium text-sm text-foreground">{item.product_name || "Product Name"}</p>
                                                                    <p className="text-xs text-muted-foreground">Qty: {item.quantity} × {formatINR(item.product_price || (item.line_total/item.quantity))}</p>
                                                                </div>
                                                            </div>
                                                            <span className="font-bold text-sm">{formatINR(item.line_total)}</span>
                                                        </div>
                                                    ))}

                                                    {/* ✅ NEW: Shipping and GST Rows */}
                                                    <div className="flex justify-between items-center p-3 bg-muted/30 border border-dashed rounded-lg">
                                                        <span className="text-sm font-medium text-muted-foreground">Shipping Fee</span>
                                                        <span className="font-bold text-sm">{formatINR(order.shipping_amount || 0)}</span>
                                                    </div>
                                                    <div className="flex justify-between items-center p-3 bg-muted/30 border border-dashed rounded-lg">
                                                        <span className="text-sm font-medium text-muted-foreground">GST (18%)</span>
                                                        <span className="font-bold text-sm">{formatINR(order.tax_amount || 0)}</span>
                                                    </div>

                                                    {/* Total Row */}
                                                    <div className="flex justify-between items-center p-3 bg-primary/5 border border-primary/20 rounded-lg mt-2">
                                                        <span className="text-sm font-bold text-primary">Total Paid</span>
                                                        <span className="font-bold text-lg text-primary">{formatINR(order.total_amount)}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* ORDER ACTIONS FOOTER */}
                                            {isEditable(order.status) && (
                                                <div className="flex justify-end mt-8 pt-4 border-t border-border/50">
                                                    <Button variant="destructive" size="sm" onClick={() => handleCancelOrder(order.id)}>
                                                        Cancel Order
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </Card>
                        ))}
                    </div>
                )}

                {/* EDIT ADDRESS DIALOG */}
                <Dialog open={isEditingAddress} onOpenChange={setIsEditingAddress}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Update Shipping Address</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="grid gap-2">
                                <Label>Street Address</Label>
                                <Input value={newAddress.address} onChange={e => setNewAddress({...newAddress, address: e.target.value})} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label>City</Label><Input value={newAddress.city} onChange={e => setNewAddress({...newAddress, city: e.target.value})} /></div>
                                <div><Label>State</Label><Input value={newAddress.state} onChange={e => setNewAddress({...newAddress, state: e.target.value})} /></div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><Label>Pincode</Label><Input value={newAddress.pincode} onChange={e => setNewAddress({...newAddress, pincode: e.target.value})} /></div>
                                <div><Label>Phone</Label><Input value={newAddress.phone} onChange={e => setNewAddress({...newAddress, phone: e.target.value})} /></div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsEditingAddress(false)}>Cancel</Button>
                            <Button onClick={saveAddress}>Save Changes</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

            </div>
        </div>
    );
}