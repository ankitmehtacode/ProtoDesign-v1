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

    if (authLoading) return null;

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-md border-b border-border shadow-sm">
            <div className="container mx-auto px-4">
                <div className="flex items-center justify-between h-20">

                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-2 group">
                        <img src={logoNav} alt="ProtoDesign" width={929} height={200} className="h-10 w-auto md:h-11" />
                    </Link>

                    {/* Desktop Nav */}
                    <div className="hidden md:flex items-center space-x-6 xl:space-x-8">
                        <Link to="/" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                            Home
                        </Link>

                        <div className="relative group h-20 flex items-center">
                            <button className="flex items-center gap-1 text-sm font-medium text-foreground/80 group-hover:text-primary transition-colors focus:outline-none">
                                Products
                                <ChevronDown size={14} className="transition-transform duration-200 group-hover:rotate-180" />
                            </button>

                            <div className="absolute top-full left-1/2 -translate-x-1/2 w-56 bg-background rounded-xl shadow-xl border border-border opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform group-hover:translate-y-0 translate-y-2 p-2">
                                {CATEGORIES.map((cat) => (
                                    <Link
                                        key={cat.name}
                                        to={cat.path}
                                        className="flex items-center justify-between px-3 py-2 hover:bg-accent rounded-lg group/item transition-colors"
                                    >
                                        <span className="text-sm text-foreground group-hover/item:text-primary">{cat.name}</span>
                                        {cat.path === '/shop' ? <Search size={14} /> : <ChevronRight size={14} className="text-muted-foreground group-hover/item:text-primary" />}
                                    </Link>
                                ))}
                            </div>
                        </div>

                        {/* lg+ only: between md and lg the wordmark and icons leave no room,
                            and these remain reachable through Products there. */}
                        {FEATURED_CATEGORIES.map(cat => (
                            <Link
                                key={cat.path}
                                to={cat.path}
                                className={`hidden lg:block text-sm font-medium transition-colors hover:text-primary ${location.pathname === cat.path ? 'text-primary' : 'text-foreground/80'}`}
                            >
                                {cat.name}
                            </Link>
                        ))}

                        <Link to="/custom" className="text-sm font-medium text-foreground/80 hover:text-primary transition-colors">
                            Custom Printing
                        </Link>

                        {/* Admin Button (Desktop) */}
                        {isAdmin && (
                            <Link to="/admin" className="text-sm font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
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
                                className="hidden sm:flex text-muted-foreground hover:text-primary"
                                aria-label="Search products" // <--- ADD THIS
                            >
                                <Search size={20} />
                            </Button>
                        </Link>

                        <Link to="/cart">
                            <Button variant="ghost" size="icon" className="relative text-muted-foreground hover:text-primary" aria-label="View cart">
                                <ShoppingCart size={20} />
                                {itemCount > 0 && (
                                    <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                                        {itemCount}
                                    </span>
                                )}
                            </Button>
                        </Link>

                        <div className="hidden md:flex items-center gap-2 ml-2 pl-2 border-l">
                            {user ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" className="flex items-center gap-2 px-2 hover:bg-accent/50">
                                            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">{user.name.charAt(0)}</div>
                                            <span className="text-sm font-medium hidden lg:block">{user.name}</span>
                                            <ChevronDown size={14} className="text-muted-foreground" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-56">
                                        <DropdownMenuLabel>My Account</DropdownMenuLabel>
                                        <DropdownMenuSeparator />

                                        <DropdownMenuItem onClick={() => navigate('/profile')}>
                                            <UserCircle className="mr-2 h-4 w-4" /> Profile
                                        </DropdownMenuItem>

                                        <DropdownMenuItem onClick={() => navigate('/orders')}>
                                            <Package className="mr-2 h-4 w-4" /> Orders
                                        </DropdownMenuItem>

                                        {/* ✅ Bulk Upload (Desktop Dropdown) */}
                                        {isAdmin && (
                                            <>
                                                <DropdownMenuSeparator />
                                                <DropdownMenuItem onClick={() => navigate('/bulk-upload')}>
                                                    <Upload className="mr-2 h-4 w-4" /> Bulk Upload
                                                </DropdownMenuItem>
                                                <DropdownMenuItem onClick={() => navigate('/admin')}>
                                                    <Settings className="mr-2 h-4 w-4" /> Admin Dashboard
                                                </DropdownMenuItem>
                                            </>
                                        )}

                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem onClick={handleSignOut} className="text-destructive">
                                            <LogOut className="mr-2 h-4 w-4" /> Sign Out
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : (
                                <Link to="/auth">
                                    <Button
                                        size="sm"
                                        className="rounded-full px-6 text-foreground font-semibold" // Added text-foreground (or text-black) and font-semibold
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
                                <Link to="/" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-accent rounded-lg">Home</Link>

                                <div>
                                    <button
                                        onClick={() => setIsProductMenuOpen(!isProductMenuOpen)}
                                        className="flex w-full items-center justify-between py-3 px-3 font-medium hover:bg-accent rounded-lg"
                                    >
                                        Products
                                        <ChevronDown size={16} className={`transition-transform ${isProductMenuOpen ? 'rotate-180' : ''}`} />
                                    </button>
                                    <div className={`pl-6 space-y-1 overflow-hidden transition-all duration-300 ${isProductMenuOpen ? 'max-h-96 pb-2' : 'max-h-0'}`}>
                                        {CATEGORIES.map(cat => (
                                            <Link key={cat.name} to={cat.path} onClick={() => setIsOpen(false)} className="block py-2 text-sm text-muted-foreground hover:text-primary">
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
                                        className={`block py-3 px-3 font-medium hover:bg-accent rounded-lg ${location.pathname === cat.path ? 'text-primary bg-primary/10' : ''}`}
                                    >
                                        {cat.name}
                                    </Link>
                                ))}

                                <Link to="/custom" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-accent rounded-lg">Custom Printing</Link>

                                {user && (
                                    <>
                                        <Link to="/profile" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-accent rounded-lg">My Profile</Link>
                                        <Link to="/orders" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-accent rounded-lg">My Orders</Link>
                                    </>
                                )}

                                {/* ✅ ADDED: Mobile Bulk Upload & Admin Links */}
                                {isAdmin && (
                                    <>
                                        <Link to="/bulk-upload" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-accent rounded-lg flex items-center gap-2">
                                            <Upload className="w-4 h-4"/> Bulk Upload
                                        </Link>
                                        <Link to="/admin" onClick={() => setIsOpen(false)} className="block py-3 px-3 font-medium hover:bg-accent rounded-lg text-primary flex items-center gap-2">
                                            <Settings className="w-4 h-4"/> Admin Dashboard
                                        </Link>
                                    </>
                                )}

                                <div className="pt-4 mt-2 border-t">
                                    {user ? (
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