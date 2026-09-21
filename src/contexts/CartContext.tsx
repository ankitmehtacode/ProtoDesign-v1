import React, { createContext, useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { apiService } from '@/services/api.service';
import { CartItem, CartContextType } from '@/types/cart';

const AUTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// Export Context so the hook can use it
export const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [items, setItems] = useState<CartItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    const loadCart = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const response = await apiService.getCart();
            setItems(response.data?.items || []);
            setIsAuthenticated(true);
        } catch (error: any) {
            console.error('Failed to load cart:', error);
            setItems([]);
            setIsAuthenticated(false);
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    useEffect(() => {
        const isAuth = apiService.isAuthenticated();
        setIsAuthenticated(isAuth);
        if (isAuth) loadCart();
        else setItems([]);
    }, [loadCart]); // Added loadCart dependency for safety

    // Periodic check: drop a stale cart if the session has ended. Registered
    // once; the functional update reads current items without the effect
    // depending on (and re-registering for) every cart change.
    useEffect(() => {
        const interval = setInterval(() => {
            if (!apiService.isAuthenticated()) {
                setItems(prev => (prev.length > 0 ? [] : prev));
                setIsAuthenticated(false);
            }
        }, AUTH_CHECK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    const addToCart = async (productId: string, quantity: number = 1) => {
        try {
            await apiService.addToCart(productId, quantity);
            await loadCart(true); // Silent update
            toast.success('Added to cart!');
        } catch (error: any) {
            toast.error(error.message || 'Failed to add to cart');
        }
    };

    const updateQuantity = async (productId: string, quantity: number) => {
        if (quantity < 1) {
            await removeFromCart(productId);
            return;
        }
        try {
            // Optimistic Update
            setItems(prev => prev.map(item =>
                item.product_id === productId ? { ...item, quantity } : item
            ));

            await apiService.updateCartItem(productId, quantity);
            await loadCart(true); // Silent update
        } catch (error: any) {
            toast.error('Failed to update cart');
            await loadCart(true); // Revert on error
        }
    };

    const removeFromCart = async (productId: string) => {
        try {
            // Optimistic Remove
            setItems(prev => prev.filter(item => item.product_id !== productId));

            await apiService.removeFromCart(productId);
            await loadCart(true);
            toast.success('Removed from cart');
        } catch (error: any) {
            toast.error('Failed to remove from cart');
            await loadCart(true);
        }
    };

    const clearCart = async () => {
        try {
            setItems([]); // Optimistic
            await apiService.clearCart();
            toast.success('Cart cleared');
        } catch (error: any) {
            toast.error('Failed to clear cart');
        }
    };

    const total = items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <CartContext.Provider
            value={{
                items,
                loading,
                addToCart,
                removeFromCart,
                updateQuantity,
                clearCart,
                total,
                itemCount,
                isAuthenticated,
                loadCart,
            }}
        >
            {children}
        </CartContext.Provider>
    );
};