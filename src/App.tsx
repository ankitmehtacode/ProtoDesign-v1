import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { CartProvider } from "@/contexts/CartContext";

// --- NEW DYNAMISM IMPORTS ---
import { HelmetProvider } from "react-helmet-async";
import { SmoothScroll } from "@/components/animations/SmoothScroll";

// --- PAGE IMPORTS ---
import Index from "./pages/Index";
import Shop from "./pages/Shop";
import CustomPrinting from "./pages/CustomPrinting";
import ProductDetail from "./pages/ProductDetail";
import CategoryPage from "./pages/CategoryPage";
import Auth from "./pages/Auth";
import AdminDashboard from "./pages/AdminDashboard";
import Cart from "./pages/Cart";
import Checkout from "./pages/Checkout";
import Orders from "./pages/Orders";
import NotFound from "./pages/NotFound";
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import Profile from "./pages/Profile";
import BulkUpload from "./pages/BulkUpload.tsx";
import { TermsPage, PrivacyPage, RefundPage, ReturnPage, ShippingPage, ContactPage } from "@/pages/Legal.tsx";
import { Footer } from "@/components/Footer"; 
import ScrollToTop from "@/components/ScrollToTop";

const queryClient = new QueryClient();

const App = () => (
    <QueryClientProvider client={queryClient}>
        {/* NEW: SEO Meta Tag Provider */}
        <HelmetProvider>
            {/* NEW: Premium Physics-based Smooth Scrolling */}
            <SmoothScroll>
                <TooltipProvider>
                    <CartProvider>
                        <Toaster />
                        <Sonner />
                        <BrowserRouter>
                            <ScrollToTop />
                            {/* Main Layout Wrapper */}
                            <div className="flex flex-col min-h-screen">
                                <Navigation />
                                {/* Content Grows to fill space */}
                                <div className="flex-1">
                                    <Routes>
                                        <Route path="/" element={<Index />} />

                                        {/* General Shop */}
                                        <Route path="/shop" element={<Shop />} />

                                        {/* --- UPDATED CATEGORY ROUTES --- */}

                                        {/* 1. 3D Printers: FDM, SLA, Metal, 3D Pen, Others */}
                                        <Route path="/printers" element={
                                            <CategoryPage
                                                category="3d_printer"
                                                title="3D Printers"
                                                subtitle="FDM, SLA, Metal 3D Printer, 3D Pen & More"
                                                subCategories={['FDM', 'SLA', 'Metal 3D Printer', '3D Pen', 'Others']}
                                            />
                                        } />

                                        {/* 2. 3D Printables: Search only */}
                                        <Route path="/printables" element={
                                            <CategoryPage
                                                category="3dprintables"
                                                title="3D Printables"
                                                subtitle="Ready-to-print models and designs."
                                                subCategories={[]}
                                            />
                                        } />

                                        {/* 3. Filaments: ABS, PETG, PLA, Carbon Fiber, Nylon Fiber, Others */}
                                        <Route path="/filaments" element={
                                            <CategoryPage
                                                category="filament"
                                                title="Premium Filaments"
                                                subtitle="High-quality materials for your FDM printer."
                                                subCategories={['ABS', 'PETG', 'PLA', 'Carbon Fiber', 'Nylon Fiber', 'Others']}
                                            />
                                        } />

                                        {/* 4. Accessories: Search Only */}
                                        <Route path="/accessories" element={
                                            <CategoryPage
                                                category="accessory"
                                                title="Accessories"
                                                subtitle="Tools and upgrades for your workstation."
                                                subCategories={[]}
                                            />
                                        } />

                                        {/* 5. Spare Parts: Search Only */}
                                        <Route path="/spare-parts" element={
                                            <CategoryPage
                                                category="spare_part"
                                                title="Spare Parts"
                                                subtitle="Essential components for maintenance and repair."
                                                subCategories={[]}
                                            />
                                        } />

                                        {/* 6. Resins: Standard, Water-Washable, Tough, Others */}
                                        <Route path="/resins" element={
                                            <CategoryPage
                                                category="resin"
                                                title="Resins"
                                                subtitle="Photopolymer resins for high-detail SLA/DLP printing."
                                                subCategories={['Standard', 'Water-Washable', 'Tough', 'Others']}
                                            />
                                        } />

                                        {/* Details & Other Pages */}
                                        <Route path="/product/:productId" element={<ProductDetail />} />
                                        <Route path="/custom" element={<CustomPrinting />} />
                                        <Route path="/cart" element={<Cart />} />
                                        <Route path="/checkout" element={<Checkout />} />
                                        <Route path="/orders" element={<Orders />} />
                                        <Route path="/auth" element={<Auth />} />
                                        <Route path="/forgot-password" element={<ForgotPassword />} />
                                        <Route path="/reset-password" element={<ResetPassword />} />
                                        <Route path="/admin" element={<AdminDashboard />} />
                                        <Route path="/bulk-upload" element={<BulkUpload />} /> 
                                        <Route path="/profile" element={<Profile />} />
                                        
                                        {/* --- LEGAL PAGES --- */}
                                        <Route path="/terms-and-conditions" element={<TermsPage />} />
                                        <Route path="/privacy-policy" element={<PrivacyPage />} />
                                        <Route path="/refund-policy" element={<RefundPage />} />
                                        <Route path="/return-policy" element={<ReturnPage />} />
                                        <Route path="/shipping-policy" element={<ShippingPage />} />
                                        <Route path="/contact" element={<ContactPage />} />

                                        {/* 404 Not Found (Must be last) */}
                                        <Route path="*" element={<NotFound />} />

                                    </Routes>
                                    {/* ✅ 2. Add Footer Here */}
                                    <Footer />
                                </div>
                            </div>
                        </BrowserRouter>
                    </CartProvider>
                </TooltipProvider>
            </SmoothScroll>
        </HelmetProvider>
    </QueryClientProvider>
);

export default App;