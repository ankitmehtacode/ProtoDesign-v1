import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from "@/hooks/use-cart";
import { apiService } from '@/services/api.service';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatINR } from '@/lib/currency';
import { Minus, Plus, Trash2, ShoppingBag, CheckCircle2 } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { motion } from 'framer-motion';

const Cart = () => {
    const navigate = useNavigate();
    const { items, removeFromCart, updateQuantity, total, itemCount, loading, loadCart } = useCart();

    useEffect(() => {
        if (apiService.isAuthenticated()) {
            loadCart();
        }
    }, []);

    // --- 160 IQ Shipping Sync Logic ---
    const hasPrinter = items.some(item => item.product.category === '3d_printer');
    const subtotal = total;
    const gst = total * 0.18;
    // Default to online shipping (₹199) or FREE (₹0) for printers
    const shipping = hasPrinter ? 0 : 199; 
    const finalTotal = subtotal + gst + shipping;

    if (loading) {
        return (
            <div className="min-h-screen pt-20 pb-10 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary rounded-full animate-spin" />
            </div>
        );
    }

    if (items.length === 0) {
        return (
            <div className="min-h-screen pt-20 pb-10">
                <section className="py-16 gradient-subtle mb-8">
                    <div className="container mx-auto px-4 text-center max-w-3xl">
                        <h1 className="font-display text-5xl md:text-6xl mb-6">Your Shopping Cart</h1>
                        <p className="text-xl text-muted-foreground">Review your items and secure your order.</p>
                    </div>
                </section>
                <div className="container mx-auto px-4">
                    <Card className="text-center py-12">
                        <ShoppingBag className="mx-auto h-16 w-16 text-muted-foreground mb-4 opacity-50" />
                        <CardTitle className="mb-2">Your cart is empty</CardTitle>
                        <Button onClick={() => navigate('/shop')}>Continue Shopping</Button>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen pt-20 pb-10 bg-slate-50/30">
            <section className="py-16 gradient-subtle mb-12">
                <div className="container mx-auto px-4 text-center max-w-3xl">
                    <h1 className="font-display text-5xl md:text-6xl mb-6">Your Shopping Cart</h1>
                    <p className="text-xl text-muted-foreground">Review your items and secure your order.</p>
                </div>
            </section>

            <div className="container mx-auto px-4">
                <h2 className="font-display text-2xl mb-8">Items ({itemCount})</h2>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-4">
                        {items.map((item) => (
                            <Card key={item.product_id} className="overflow-hidden border-none shadow-sm">
                                <CardContent className="p-6">
                                    <div className="flex flex-col sm:flex-row gap-6">
                                        {item.product.image_url && (
                                            <div className="w-full sm:w-24 h-40 sm:h-24 rounded-lg overflow-hidden bg-white flex-shrink-0 border">
                                                <img src={item.product.image_url} alt={item.product.name} className="w-full h-full object-contain" />
                                            </div>
                                        )}
                                        <div className="flex-1">
                                            <h3 className="font-semibold text-lg mb-1">{item.product.name}</h3>
                                            <p className="text-sm text-muted-foreground mb-2 capitalize">{item.product.category.replace(/_/g, ' ')}</p>
                                            <p className="text-primary font-bold text-lg">{formatINR(item.product.price)} each</p>
                                        </div>
                                        <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between gap-4">
                                            <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
                                                <Button variant="ghost" size="sm" onClick={() => updateQuantity(item.product_id, item.quantity - 1)} disabled={item.quantity <= 1}><Minus className="w-4 h-4" /></Button>
                                                <span className="w-8 text-center font-semibold">{item.quantity}</span>
                                                <Button variant="ghost" size="sm" onClick={() => updateQuantity(item.product_id, item.quantity + 1)}><Plus className="w-4 h-4" /></Button>
                                            </div>
                                            <Button variant="ghost" size="sm" onClick={() => removeFromCart(item.product_id)} className="text-destructive hover:bg-destructive/10"><Trash2 className="w-4 h-4 mr-1" /> Remove</Button>
                                            <div className="text-right"><p className="font-bold text-lg">{formatINR(item.product.price * item.quantity)}</p></div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    <div className="lg:col-span-1">
                        <Card className="sticky top-24 shadow-lg border-2 border-primary/5">
                            <CardHeader><CardTitle>Order Summary</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-3">
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">Subtotal:</span>
                                        <span>{formatINR(subtotal)}</span>
                                    </div>
                                    <div className="flex justify-between text-sm items-center">
                                        <span className="text-muted-foreground flex items-center gap-1.5">
                                            Shipping {hasPrinter && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                                        </span>
                                        <span className={shipping === 0 ? "text-green-600 font-bold" : ""}>
                                            {shipping === 0 ? "FREE" : formatINR(shipping)}
                                        </span>
                                    </div>
                                    <div className="flex justify-between text-sm">
                                        <span className="text-muted-foreground">GST (18%):</span>
                                        <span>{formatINR(gst)}</span>
                                    </div>
                                </div>
                                <Separator />
                                <div className="flex justify-between font-bold text-xl">
                                    <span>Total:</span>
                                    <span className="text-primary">{formatINR(finalTotal)}</span>
                                </div>
                                <Button className="w-full h-12 text-lg shadow-md" onClick={() => navigate('/checkout')}>Proceed to Checkout</Button>
                                {hasPrinter && (
                                    <p className="text-[10px] text-center text-green-600 font-medium">✨ You've unlocked FREE Shipping by purchasing a 3D Printer!</p>
                                )}
                                <Button variant="outline" className="w-full" onClick={() => navigate('/shop')}>Continue Shopping</Button>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Cart;
