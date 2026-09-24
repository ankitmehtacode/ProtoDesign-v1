import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Navigation } from "@/components/Navigation";
import { CartProvider } from "@/contexts/CartContext";

// --- NEW DYNAMISM IMPORTS ---
import { lazy, Suspense } from "react";
import { RouteSeo } from "@/seo/RouteSeo";
import { SmoothScroll } from "@/components/animations/SmoothScroll";

// --- PAGE IMPORTS ---
import Index from "./pages/Index";
import Shop from "./pages/Shop";
import CategoryPage from "./pages/CategoryPage";
import NotFound from "./pages/NotFound";
import { TermsPage, PrivacyPage, RefundPage, ReturnPage, ShippingPage, ContactPage } from "@/pages/Legal.tsx";
import { Footer } from "@/components/Footer"; 
import ScrollToTop from "@/components/ScrollToTop";


// Split out of the main bundle: the quote page pulls in three.js (~1 MB) and
// admin/checkout are only for signed-in users. Home, shop and category pages
// stay eager because they are where search visitors land.
const CustomPrinting = lazy(() => import("./pages/CustomPrinting"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const Auth = lazy(() => import("./pages/Auth"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const Cart = lazy(() => import("./pages/Cart"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Orders = lazy(() => import("./pages/Orders"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const Profile = lazy(() => import("./pages/Profile"));
const BulkUpload = lazy(() => import("./pages/BulkUpload.tsx"));

const queryClient = new QueryClient();

const App = () => (
    <QueryClientProvider client={queryClient}>
            {/* NEW: Premium Physics-based Smooth Scrolling */}
            <SmoothScroll>
                <TooltipProvider>
                    <CartProvider>
                        <Toaster />
                        <Sonner />
                        <BrowserRouter>
                            <ScrollToTop />
                            <RouteSeo />
                            {/* Main Layout Wrapper */}
                            <div className="flex flex-col min-h-screen">
                                <Navigation />
                                {/* Content Grows to fill space */}
                                <div className="flex-1">
                                    <Suspense fallback={<div className="min-h-screen" />}>
                                    <Routes>
                                        <Route path="/" element={<Index />} />

                                        {/* General Shop */}
                                        <Route path="/shop" element={<Shop />} />

                                        {/* --- UPDATED CATEGORY ROUTES --- */}

                                        {/* 1. 3D Printers: FDM, SLA, Metal, 3D Pen, Others */}
                                        <Route path="/printers" element={
                                            <CategoryPage
                                                category="3d_printer"
                                                eyebrow="3D Printers"
                                                title="Machines that make things."
                                                subtitle="FDM, resin and metal printers, plus 3D pens. From a first print to production runs."
                                                subCategories={['FDM', 'SLA', 'Metal 3D Printer', '3D Pen', 'Others']}
                                            />
                                        } />

                                        {/* 2. 3D Printables: Search only */}
                                        <Route path="/printables" element={
                                            <CategoryPage
                                                category="3dprintables"
                                                eyebrow="3D Printables"
                                                title="Ready to take home."
                                                subtitle="Finished pieces, designed and printed by us."
                                                subCategories={[]}
                                            />
                                        } />

                                        {/* 3. Filaments: ABS, PETG, PLA, Carbon Fiber, Nylon Fiber, Others */}
                                        <Route path="/filaments" element={
                                            <CategoryPage
                                                category="filament"
                                                eyebrow="Filaments"
                                                title="Colour by the spool."
                                                subtitle="PLA, PETG, ABS, nylon and carbon fibre for FDM printers."
                                                subCategories={['ABS', 'PETG', 'PLA', 'Carbon Fiber', 'Nylon Fiber', 'Others']}
                                            />
                                        } />

                                        {/* 4. Accessories: Search Only */}
                                        <Route path="/accessories" element={
                                            <CategoryPage
                                                category="accessory"
                                                eyebrow="Accessories"
                                                title="Small things, better prints."
                                                subtitle="Tools and upgrades for the bench."
                                                subCategories={[]}
                                            />
                                        } />

                                        {/* 5. Spare Parts: Search Only */}
                                        <Route path="/spare-parts" element={
                                            <CategoryPage
                                                category="spare_part"
                                                eyebrow="Spare parts"
                                                title="Keep it running."
                                                subtitle="Replacement parts for maintenance and repair."
                                                subCategories={[]}
                                            />
                                        } />

                                        {/* 6. Resins: Standard, Water-Washable, Tough, Others */}
                                        <Route path="/resins" element={
                                            <CategoryPage
                                                category="resin"
                                                eyebrow="Resins"
                                                title="Detail, down to the layer."
                                                subtitle="Photopolymer resins for SLA and DLP printers."
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
                                    </Suspense>
                                    {/* ✅ 2. Add Footer Here */}
                                    <Footer />
                                </div>
                            </div>
                        </BrowserRouter>
                    </CartProvider>
                </TooltipProvider>
            </SmoothScroll>
    </QueryClientProvider>
);

export default App;