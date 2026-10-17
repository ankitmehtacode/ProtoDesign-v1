import { useState, useEffect, useCallback } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
    Menu,
    X,
    ShoppingCart,
    ChevronDown,
    ChevronRight,
    Search,
    LogOut,
    UserCircle,
    Package,
    Settings,
    Upload // ✅ Import Upload Icon
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { apiService } from "@/services/api.service";
import { useCart } from "@/hooks/use-cart";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import logoNav from "@/assets/logo-nav-light.webp";
import { FestivalBar } from "@/components/shop/FestivalBar";
import { cn } from "@/lib/utils";

interface UserInfo {
    id: string;
    email: string;
    name: string;
    role?: string;
}

const CATEGORIES = [
    { name: "All Products", path: "/shop" },
    { name: "3D Printers", path: "/printers" },
    { name: "3D Printables", path: "/printables" },
    { name: "Filaments", path: "/filaments" },
    { name: "Resins", path: "/resins" },
    { name: "Accessories", path: "/accessories" },
    { name: "Spare Parts", path: "/spare-parts" },
];

// Promoted out of the Products dropdown to top-level links; they stay in the
// dropdown too so it remains the complete category list.
const FEATURED_CATEGORIES = CATEGORIES.filter(c => ['/printers', '/printables', '/filaments'].includes(c.path));

// Frosted glass for both nav menus: a faint top-lit sheen over a translucent tint,
// a hairline edge, an inner highlight and a deep soft shadow. Utilities rather than
// a CSS class so cn() can replace DropdownMenuContent's opaque popover defaults.
const GLASS_PANEL = "rounded-2xl border border-foreground/10 bg-background/60 bg-gradient-to-b from-foreground/[0.07] to-foreground/[0.01] backdrop-blur-2xl backdrop-saturate-150 shadow-[inset_0_1px_0_hsl(var(--foreground)/0.08),0_24px_48px_-12px_rgb(0_0_0/0.6)]";
const GLASS_ITEM = "rounded-lg px-3 py-2 text-[13px] text-foreground/75 transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus:bg-foreground/[0.06] focus:text-foreground focus-visible:outline-none";

export const Navigation = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [isProductMenuOpen, setIsProductMenuOpen] = useState(false);
    const [user, setUser] = useState<UserInfo | null>(null);
    const [isAdmin, setIsAdmin] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();
    const { itemCount } = useCart();

    const checkAuthStatus = useCallback(async () => {
        try {
            if (!apiService.isAuthenticated()) {
                setUser(null);
                setIsAdmin(false);
                return;
            }

            const userInfo = await apiService.getCurrentUser();
            let fullName = userInfo.user?.fullName || userInfo.user?.email?.split("@")[0];
            if (fullName) {
                fullName = fullName.charAt(0).toUpperCase() + fullName.slice(1);
            }

            setUser({
                id: userInfo.id || userInfo.user?.id || '',
                email: userInfo.user?.email || '',
                name: fullName,
                role: userInfo.role || userInfo.user?.role,
            });

            setIsAdmin(userInfo.role === 'admin' || userInfo.user?.role === 'admin');

        } catch (error: any) {
            console.error('Auth check failed:', error);
            if (error.message && (error.message.includes('401') || error.message.includes('Unauthorized'))) {
                apiService.clearToken();
                setUser(null);
                setIsAdmin(false);
            }
        }
    }, []);

    useEffect(() => {
        const initAuth = async () => {
            await checkAuthStatus();
            setAuthLoading(false);
        };
        initAuth();
    }, [checkAuthStatus, location.pathname]);

    const handleSignOut = async () => {
        try {
            apiService.clearToken();
            setUser(null);
            setIsAdmin(false);
            navigate("/");
        } catch (error) {
            console.error('Sign out error:', error);
        }
        setIsOpen(false);
    };

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border shadow-sm">
            {/* The bar's own frost lives on this layer, not on <nav>: an element with
                backdrop-filter is a backdrop root, and the Products menu's glass would
                then blur only the bar instead of the page under it. */}
            <div aria-hidden className="absolute inset-0 -z-10 bg-background/95 backdrop-blur-md" />
            <FestivalBar />
            <div className="container mx-auto px-4">
                <div className="flex items-center justify-between h-20">

                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-2 group">
                        <img src={logoNav} alt="ProtoDesign" width={929} height={200} className="h-10 w-auto md:h-11" />
                    </Link>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center space-x-6 xl:space-x-8">
                        <Link to="/" className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
                            Home
                        </Link>

                        <div className="relative group h-20 flex items-center">
                            {/* Opens on hover and on keyboard focus (focus-within), so every
                                category is reachable without a mouse. */}
                            <button aria-haspopup="true" className="flex items-center gap-1 rounded-sm text-sm font-medium text-foreground/80 group-hover:text-foreground group-focus-within:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4">
                                Products
                                <ChevronDown size={14} className="transition-transform duration-200 group-hover:rotate-180 group-focus-within:rotate-180" />
                            </button>

                            {/* pt-2 floats the panel clear of the bar while keeping the gap
                                hoverable, so crossing it does not close the menu. */}
                            <div className="absolute top-full left-1/2 -translate-x-1/2 pt-2 invisible transition-[visibility] duration-200 group-hover:visible group-focus-within:visible motion-reduce:transition-none">
                                <div className={`${GLASS_PANEL} w-60 p-1.5 origin-top opacity-0 -translate-y-1 scale-[0.98] transition duration-200 ease-out group-hover:opacity-100 group-hover:translate-y-0 group-hover:scale-100 group-focus-within:opacity-100 group-focus-within:translate-y-0 group-focus-within:scale-100 motion-reduce:transition-none motion-reduce:transform-none`}>
                                    {CATEGORIES.map((cat) => {
                                        const current = location.pathname === cat.path;
                                        return (
                                            <Link
                                                key={cat.name}
                                                to={cat.path}
                                                aria-current={current ? 'page' : undefined}
                                                className={cn(GLASS_ITEM, "group/item flex items-center justify-between focus-visible:bg-foreground/[0.06] focus-visible:text-foreground", current && "text-foreground", cat.path === '/shop' && "mb-1")}
                                            >
                                                <span className="flex items-center gap-2.5">
                                                    <span className={`h-1 w-1 rounded-full transition-colors ${current ? 'bg-primary' : 'bg-foreground/20 group-hover/item:bg-foreground/50'}`} />
                                                    {cat.name}
                                                </span>
                                                {cat.path === '/shop'
                                                    ? <Search size={13} className="text-foreground/40 group-hover/item:text-foreground/80 transition-colors" />
                                                    : <ChevronRight size={13} className="text-foreground/60 opacity-0 -translate-x-1 transition duration-200 group-hover/item:opacity-100 group-hover/item:translate-x-0 group-focus-visible/item:opacity-100 group-focus-visible/item:translate-x-0 motion-reduce:transition-none" />}
                                            </Link>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* lg+ only: between md and lg the wordmark and icons leave no room,
                            and these remain reachable through Products there. */}
                        {FEATURED_CATEGORIES.map(cat => (
                            <Link
                                key={cat.path}
                                to={cat.path}
                                className={`hidden lg:block text-sm font-medium transition-colors hover:text-foreground ${location.pathname === cat.path ? 'text-foreground' : 'text-foreground/80'}`}
                            >
                                {cat.name}
                            </Link>
                        ))}

                        <Link to="/custom" className="text-sm font-medium text-foreground/80 hover:text-foreground transition-colors">
                            Custom Printing
                        </Link>

                        {/* Admin Button (Desktop) */}
                        {isAdmin && (
                            <Link to="/admin" className="text-sm font-medium text-accent hover:text-foreground transition-colors flex items-center gap-1">
                                Admin Dashboard
                            </Link>
                        )}
                    </div>

                    {/* Right Icons */}
                    <div className="flex items-center gap-2">
                        <Link to="/shop">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="hidden sm:flex text-muted-foreground hover:text-foreground"
                                aria-label="Search products" // <--- ADD THIS
                            >
                                <Search size={20} />
                            </Button>
                        </Link>

                        <Link to="/cart">
                            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-foreground" aria-label="View cart">
                                <ShoppingCart size={20} />
                                {itemCount > 0 && (
                                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                                        {itemCount}
                                    </span>
                                )}
                            </Button>
                        </Link>

                        {/* Until the session check answers, hold the space instead of flashing
                            "Sign In" at someone who is signed in. The rest of the bar renders now. */}
                        <div className="hidden md:flex items-center gap-2 ml-2 pl-2 border-l min-w-[6.5rem]">
                            {authLoading ? null : user ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" className="flex items-center gap-2 px-2 hover:bg-muted">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-accent font-bold">{user.name.charAt(0)}</div>
                                            <span className="text-sm font-medium hidden lg:block">{user.name}</span>
                                            <ChevronDown size={14} className="text-muted-foreground" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" sideOffset={10} className={`${GLASS_PANEL} w-64 p-1.5 text-foreground`}>
                                        <DropdownMenuLabel className="px-3 py-2 font-normal">
                                            <span className="block truncate text-sm font-medium text-foreground">{user.name}</span>
                                            <span className="block truncate text-xs text-foreground/50">{user.email}</span>
                                        </DropdownMenuLabel>
                                        <DropdownMenuSeparator className="mx-1.5 bg-foreground/10" />

                                        <DropdownMenuItem className={`${GLASS_ITEM} cursor-pointer`} onClick={() => navigate('/profile')}>
                                            <UserCircle className="mr-2.5 h-4 w-4 opacity-60" /> Profile
                                        </DropdownMenuItem>

                                        <DropdownMenuItem className={`${GLASS_ITEM} cursor-pointer`} onClick={() => navigate('/orders')}>
                                            <Package className="mr-2.5 h-4 w-4 opacity-60" /> Orders
                                        </DropdownMenuItem>

                                        {isAdmin && (
                                            <>
                                                <DropdownMenuSeparator className="mx-1.5 bg-foreground/10" />
                                                <DropdownMenuItem className={`${GLASS_ITEM} cursor-pointer`} onClick={() => navigate('/bulk-upload')}>
                                                    <Upload className="mr-2.5 h-4 w-4 opacity-60" /> Bulk Upload
                                                </DropdownMenuItem>
                                                <DropdownMenuItem className={`${GLASS_ITEM} cursor-pointer`} onClick={() => navigate('/admin')}>
                                                    <Settings className="mr-2.5 h-4 w-4 opacity-60" /> Admin Dashboard
                                                </DropdownMenuItem>
                                            </>
                                        )}

                                        <DropdownMenuSeparator className="mx-1.5 bg-foreground/10" />
                                        <DropdownMenuItem onClick={handleSignOut} className={`${GLASS_ITEM} cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive`}>
                                            <LogOut className="mr-2.5 h-4 w-4" /> Sign Out
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <Link to="/auth">
                                    <Button
                                        size="sm"
                                        className="rounded-full px-6 text-primary-foreground font-semibold"
                                    >
                                        Sign In
                                    </Button>
                                </Link>
                            )}
                        </div>

                        {/* Mobile Toggle */}
                        <button
                            className="md:hidden p-2 text-foreground/80"
                            onClick={() => setIsOpen(!isOpen)}
                            aria-label="Toggle main menu"
                        >
                            {isOpen ? <X size={24} /> : <Menu size={24} />}
                        </button>
                    </div>
                </div>

                {/* Mobile Menu */}
                <AnimatePresence>
                    {isOpen && (
                        <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                            className="md:hidden overflow-hidden border-t bg-background"
                        >
                            <div className="py-4 space-y-1 px-4">
                                <Link to="/" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-muted rounded-lg">Home</Link>

                                <div>
                                    <button
                                        onClick={() => setIsProductMenuOpen(!isProductMenuOpen)}
                                        className="flex w-full items-center justify-between py-3 px-3 font-medium hover:bg-muted rounded-lg"
                                    >
                                        Products
                                        <ChevronDown size={16} className={`transition-transform ${isProductMenuOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div className={`pl-6 space-y-1 overflow-hidden transition-all duration-300 ${isProductMenuOpen ? 'max-h-96 pb-2' : 'max-h-0'}`}>
                                        {CATEGORIES.map(cat => (
                                            <Link key={cat.name} to={cat.path} onClick={() => setIsOpen(false)} className="block py-2 text-sm text-muted-foreground hover:text-foreground">
                                                {cat.name}
                                            </Link>
                                        ))}
                                    </div>
                                </div>

                                {FEATURED_CATEGORIES.map(cat => (
                                    <Link
                                        key={cat.path}
                                        to={cat.path}
                                        onClick={() => setIsOpen(false)}
                                        className={`block py-3 px-3 font-medium hover:bg-muted rounded-lg ${location.pathname === cat.path ? 'bg-primary/15' : ''}`}
                                    >
                                        {cat.name}
                                    </Link>
                                ))}

                                <Link to="/custom" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-muted rounded-lg">Custom Printing</Link>

                                {user && (
                                    <>
                                        <Link to="/profile" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-muted rounded-lg">My Profile</Link>
                                        <Link to="/orders" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-muted rounded-lg">My Orders</Link>
                                    </>
                                )}

                                {/* ✅ ADDED: Mobile Bulk Upload & Admin Links */}
                                {isAdmin && (
                                    <>
                                        <Link to="/bulk-upload" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-muted rounded-lg flex items-center gap-2">
                                            <Upload className="w-4 h-4"/> Bulk Upload
                                        </Link>
                                        <Link to="/admin" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-muted rounded-lg text-accent flex items-center gap-2">
                                            <Settings className="w-4 h-4"/> Admin Dashboard
                                        </Link>
                                    </>
                                )}

                                <div className="pt-4 mt-2 border-t">
                                    {authLoading ? null : user ? (
                                        <Button variant="outline" className="w-full justify-start" onClick={handleSignOut}>
                                            <LogOut className="w-4 h-4 mr-2" /> Sign Out ({user.name})
                                        </Button>
                                    ) : (
                                        <Link to="/auth" onClick={() => setIsOpen(false)}>
                                            <Button className="w-full">Sign In</Button>
                                        </Link>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </nav>
    );
};