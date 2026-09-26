import React from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Mail, Phone, MapPin } from "lucide-react";

// Shared Layout for all Legal Pages to ensure UI consistency
const LegalPageLayout = ({ title, lastUpdated, children }: { title: string, lastUpdated: string, children: React.ReactNode }) => {
    return (
        <div className="min-h-screen bg-background pt-28 pb-16">
            <div className="container mx-auto px-4 max-w-4xl">

                {/* Back Button */}
                <div className="mb-6">
                    <Link to="/">
                        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground">
                            <ChevronLeft className="h-4 w-4" /> Back to Home
                        </Button>
                    </Link>
                </div>

                <Card className="p-8 md:p-12 shadow-sm border border-border/60 bg-card">
                    {/* Header */}
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8">
                        <div>
                            <h1 className="text-3xl md:text-4xl font-display font-bold text-foreground tracking-tight">{title}</h1>
                            <p className="text-muted-foreground mt-2 text-sm">Last Updated: {lastUpdated}</p>
                        </div>

                        {/* Trust/Contact Block */}
                        <div className="flex flex-col gap-2 text-sm text-muted-foreground md:text-right bg-muted/30 p-4 rounded-lg border border-border/50">
                            <div className="font-semibold text-foreground mb-1">ProtoDesign</div>
                            <a href="mailto:help@protodesignstudio.com" className="flex items-center gap-2 hover:text-primary transition-colors justify-start md:justify-end">
                                <Mail className="h-3.5 w-3.5" /> help@protodesignstudio.com
                            </a>
                            <a href="tel:+918249581682" className="flex items-center gap-2 hover:text-primary transition-colors justify-start md:justify-end">
                                <Phone className="h-3.5 w-3.5" /> +91 8249581682
                            </a>
                        </div>
                    </div>

                    <Separator className="mb-10" />

                    {/* Policy Content - Prosed for readability */}
                    <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-foreground/90 leading-relaxed">
                        {children}
                    </div>

                    {/* Footer for Legal Pages */}
                    <div className="mt-16 pt-8 border-t border-border flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
                        <p>© {new Date().getFullYear()} Zon Robotics and AI Pvt. Ltd. All rights reserved.</p>
                        <div className="flex gap-6">
                            <Link to="/privacy-policy" className="hover:text-primary transition-colors">Privacy</Link>
                            <Link to="/terms-and-conditions" className="hover:text-primary transition-colors">Terms</Link>
                            <Link to="/shipping-policy" className="hover:text-primary transition-colors">Shipping</Link>
                        </div>
                    </div>
                </Card>
            </div>
        </div>
    );
};

// --- 1. TERMS & CONDITIONS ---
export const TermsPage = () => (
    <LegalPageLayout title="Terms & Conditions" lastUpdated="January 12, 2026">
        <h3>1. Introduction</h3>
        <p>
            Welcome to <strong>ProtoDesign</strong>. By accessing our website and using our services, you agree to be bound by these Terms and Conditions.
            If you do not agree with any part of these terms, please do not use our platform.
        </p>

        <h3>2. Legal Entity Declaration</h3>
        <p>
            "ProtoDesign" is a brand owned and operated by <strong>Zon Robotics and AI Pvt. Ltd.</strong><br/>
            All invoices and payments will be processed under the name of <strong>Zon Robotics and AI Pvt. Ltd.</strong></p>

        <h3>3. Company Information</h3>
        <p>
            <strong>Registered Office:</strong><br/>
            Zon Robotics and AI Pvt. Ltd.<br/>
            CIN: U72100MP2025PTC077687<br/>
            GSTIN: 23AACCZ6818Q1ZO<br/>
            01, Marg, Jawahar Tekri, Sinhasa<br/>
            Indore, Madhya Pradesh, 452009, India.
        </p>

        <h3>4. Products & Services</h3>
        <p>
            We provide 3D printers, filaments, accessories, and custom 3D printing services. We strive to display product colors and specifications accurately; however,
            we do not guarantee that your device's display will accurately reflect the actual color of the products.
        </p>

        <h3>5. User Obligations</h3>
        <p>
            You agree to provide accurate and current information during registration and checkout. You are responsible for maintaining the confidentiality of your account credentials.
        </p>

        <h3>6. Governing Law</h3>
        <p>
            These Terms shall be governed by and construed in accordance with the laws of India. Any disputes arising out of these terms shall be subject to the exclusive jurisdiction of the courts in Indore, Madhya Pradesh.
        </p>
    </LegalPageLayout>
);

// --- 2. PRIVACY POLICY ---
export const PrivacyPage = () => (
    <LegalPageLayout title="Privacy Policy" lastUpdated="January 12, 2026">
        <h3>1. Information Collection</h3>
        <p>
            We collect personal information necessary to fulfill your orders and improve your shopping experience. This includes:
        </p>
        <ul className="list-disc pl-5">
            <li><strong>Identity Data:</strong> Name, Username.</li>
            <li><strong>Contact Data:</strong> Billing address, Shipping address, Email address, and Phone number (e.g., +91 8249581682).</li>
            <li><strong>Transaction Data:</strong> Details of products ordered and payment timestamps.</li>
        </ul>

        <h3>2. How We Use Your Data</h3>
        <p>
            Your data is used strictly for:
        </p>
        <ul>
            <li>Processing your orders and managing payments.</li>
            <li>Delivering products via our logistics partners.</li>
            <li>Sending order updates, invoices, and support communications.</li>
        </ul>

        <h3>3. Data Security</h3>
        <p>
            We do not store your Credit/Debit card numbers or UPI PINs. All payments are processed through secure, PCI-DSS compliant payment gateways.
            We implement industry-standard security measures to protect your personal information from unauthorized access.
        </p>

        <h3>4. Third-Party Sharing</h3>
        <p>
            We do not sell your data. We only share necessary details (Name, Address, Phone) with our courier partners (e.g., BlueDart, Delhivery) to facilitate the delivery of your package.
        </p>
    </LegalPageLayout>
);

// --- 3. REFUND POLICY ---
export const RefundPage = () => (
    <LegalPageLayout title="Refund Policy" lastUpdated="January 12, 2026">
        <div className="p-4 bg-primary/10 border-l-4 border-primary rounded-r-md mb-6">
            <p className="font-medium text-foreground">
                <strong>Standard Returns:</strong> We accept returns for manufacturing defects reported within 7 days.
            </p>
        </div>

        <h3>1. Refund/Cancellation</h3>
        <p>
            We prioritize quality. Returns or replacements are accepted ONLY under the following conditions:
        </p>
        <ul className="list-disc pl-5">
            <li>Cancellations will only be considered if the request is made within 7 days of placing the order. However, cancellation requests may not be accepted once we have shipped the order or it is out for delivery. In such an event, you may choose to reject the product at the doorstep.</li>
            <li>In case of receipt of damaged or defective items, please report to our customer service team. The request will be accepted once we have inspected the item and confirmed the damage or defect. This should be reported within 7 days of receipt of products. If the product received is different from its description on the site, you must bring it to the notice of our customer service within 7 days of receiving the product. The customer service team after looking into your complaint will take an appropriate decision.</li>
            <li>In case of complaints regarding the products that come with a warranty from the manufacturers, please refer the issue to them.</li>
            <li>In case of any refunds approved by ProtoDesign, it will take 7 days for the refund to be processed to you.</li>
            <li>If any damaged/defective/replacement products are inspected and accepted then it will be delivered within 5 to 7 business days </li>
        </ul>

        <h3>2. Custom 3D Printing</h3>
        <p>
            Due to the personalized nature of Custom 3D Printing services, these orders are <strong>non-refundable</strong> unless the printed part is broken upon arrival or significantly deviates from the design file provided.
        </p>
    </LegalPageLayout>
);

// --- 3. RETURN POLICY ---
export const ReturnPage = () => (
    <LegalPageLayout title="Return Policy" lastUpdated="September 26, 2026">
        <div className="p-4 bg-primary/10 border-l-4 border-primary rounded-r-md mb-6">
            <p className="font-medium text-foreground">
                <strong>Defects only:</strong> We accept returns only for items that arrive defective, damaged, or different from their description, reported within 7 days of delivery.
            </p>
        </div>

        <h3>1. What we accept</h3>
        <p>We will replace or refund an item that:</p>
        <ul className="list-disc pl-5">
            <li>has a manufacturing defect,</li>
            <li>arrived damaged in transit, or</li>
            <li>is different from what was described on the product page (wrong item, material or size).</li>
        </ul>
        <p>
            Report it within <strong>7 days of delivery</strong> to help@protodesignstudio.com or +91 8249581682, with your order number and photos of the item and packaging.
        </p>

        <h3>2. What we do not accept</h3>
        <p>
            We do not accept returns or exchanges for a change of mind, or for items damaged after delivery through misuse or incorrect installation.
            Requests made more than 7 days after delivery cannot be accepted.
        </p>

        <h3>3. How a return is handled</h3>
        <p>
            We may ask you to send the item back so we can inspect it. Once we confirm the defect, damage or mismatch, we will send a replacement or refund you as you prefer.
            Refunds follow our Refund Policy.
        </p>

        <h3>4. Custom 3D Printing</h3>
        <p>
            Due to the personalized nature of Custom 3D Printing services, these orders are <strong>non-returnable</strong> unless the printed part is broken upon arrival or significantly deviates from the design file provided.
        </p>
    </LegalPageLayout>
);

// --- 4. SHIPPING POLICY ---
export const ShippingPage = () => (
    <LegalPageLayout title="Shipping Policy" lastUpdated="January 12, 2026">
        <h3>1. Order Processing</h3>
        <p>
            All in-stock orders (Printers, Filaments, Accessories) are processed and dispatched within <strong>2-3 business days</strong>.
            Custom 3D printing orders may take additional time for production, which will be communicated at the time of order.
        </p>

        <h3>2. Delivery Timelines</h3>
        <p>
            We ship via reputed courier partners to ensure safe delivery. Standard delivery estimates are:
        </p>
        <ul className="list-disc pl-5">
            <li><strong>Metro Cities:</strong> 3-5 Working Days</li>
            <li><strong>Rest of India:</strong> 5-7 Working Days</li>
            <li><strong>Remote / North East:</strong> 7-10 Working Days</li>
        </ul>

        <h3>3. Shipping Costs</h3>
        <p>
            Shipping charges are calculated at checkout based on the total weight of the package and your destination pincode.
        </p>

        <h3>4. Tracking</h3>
        <p>
            Once your order is shipped, you will receive a tracking link via email (help@protodesignstudio.com) and SMS to track your package in real-time.
        </p>
    </LegalPageLayout>
);

// --- 5. CONTACT US (Added for PhonePe Requirement) ---
export const ContactPage = () => (
    <LegalPageLayout title="Contact Us" lastUpdated="January 12, 2026">
        <p>We are here to help! Reach out to us via:</p>

        <div className="grid gap-6 md:grid-cols-2 mt-8">
            <div className="p-6 border rounded-lg bg-muted/20">
                <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><Phone className="w-5 h-5 text-primary"/> Phone</h4>
                <p>+91 8249581682</p>
                <p className="text-sm text-muted-foreground">Mon-Sat, 10 AM - 7 PM</p>
            </div>

            <div className="p-6 border rounded-lg bg-muted/20">
                <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><Mail className="w-5 h-5 text-primary"/> Email</h4>
                <p>help@protodesignstudio.com</p>
                <p className="text-sm text-muted-foreground">Response within 24 hours</p>
            </div>

            <div className="p-6 border rounded-lg bg-muted/20 md:col-span-2">
                <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><MapPin className="w-5 h-5 text-primary"/> Registered Office</h4>
                <p>Zon Robotics and AI Pvt. Ltd. (CIN U72100MP2025PTC077687, GSTIN 23AACCZ6818Q1ZO)</p>
                <p>01, Marg, Jawahar Tekri, Sinhasa</p>
                <p>Indore, Madhya Pradesh, 452009</p>
                <p>India</p>
            </div>
        </div>
    </LegalPageLayout>
);