import { Link } from "react-router-dom";
import { Separator } from "@/components/ui/separator.tsx";
import { Mail, Phone, MapPin, Facebook, Instagram, Youtube } from "lucide-react";
import logoLockup from "@/assets/logo-lockup-light.webp";
import { FaWhatsapp } from "react-icons/fa";
import { useWhatsAppStatus } from "@/hooks/use-whatsapp-status";

export const Footer = () => {
    const { data: whatsapp } = useWhatsAppStatus();
    return (
        <footer className="bg-secondary/20 border-t border-border mt-auto">
            <div className="container mx-auto px-4 py-12">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-8">

                    {/* Column 1: Brand */}
                    <div className="space-y-4">
                        <Link to="/" className="inline-block">
                            <img src={logoLockup} alt="ProtoDesign Technologies, additive manufacturing" width={767} height={640} loading="lazy" className="h-32 w-auto" />
                        </Link>
                        <p className="text-sm text-foreground/80 leading-relaxed">
                            Empowering creators with premium 3D printing solutions. From high-end printers to custom prototyping services.
                        </p>
                    </div>

                    {/* Column 2: Quick Links */}
                    <div>
                        <h3 className="font-semibold mb-4">Shop</h3>
                        <ul className="text-sm text-foreground/80 md:space-y-2">
                            <li><Link to="/printers" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">3D Printers</Link></li>
                            <li><Link to="/filaments" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Filaments</Link></li>
                            <li><Link to="/resins" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Resins</Link></li>
                            <li><Link to="/custom" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Custom Printing</Link></li>
                        </ul>
                    </div>

                    {/* Column 3: Legal & Support */}
                    <div>
                        <h3 className="font-semibold mb-4">Support</h3>
                        <ul className="text-sm text-foreground/80 md:space-y-2">
                            <li><Link to="/orders" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Track Order</Link></li>
                            <li><Link to="/terms-and-conditions" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Terms & Conditions</Link></li>
                            <li><Link to="/privacy-policy" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Privacy Policy</Link></li>
                            <li><Link to="/return-policy" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Return Policy</Link></li>
                            <li><Link to="/refund-policy" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Refund Policy</Link></li>
                            <li><Link to="/shipping-policy" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Shipping Policy</Link></li>
                            <li><Link to="/contact" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Contact Us</Link></li>
                            <li><Link to="/contact" className="inline-block py-2.5 transition-colors hover:text-primary md:py-0">Grievance Officer</Link></li>
                        </ul>
                    </div>

                    {/* Column 4: Contact */}
                    <div>
                        <h3 className="font-semibold mb-4">Contact Us</h3>
                        <ul className="text-sm text-foreground/80 md:space-y-3">
                            <li className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-primary" />
                                <a href="mailto:help@protodesignstudio.com" className="inline-block py-2.5 hover:text-primary md:py-0">help@protodesignstudio.com</a>
                            </li>
                            <li className="flex items-center gap-2">
                                <Phone className="w-4 h-4 text-primary" />
                                <a href="tel:+918249581682" className="inline-block py-2.5 hover:text-primary md:py-0">+91 8249581682</a>
                            </li>
                            {whatsapp?.enabled && whatsapp.chatUrl && (
                                <li className="flex items-center gap-2">
                                    <FaWhatsapp className="w-4 h-4 text-primary" />
                                    <a href={whatsapp.chatUrl} target="_blank" rel="noopener noreferrer" className="inline-block py-2.5 hover:text-primary md:py-0">Chat with ProtoDesign</a>
                                </li>
                            )}
                            <li className="flex items-start gap-2 py-2.5 md:py-0">
                                <MapPin className="w-4 h-4 text-primary mt-0.5" />
                                <span>01, Marg, Jawahar Tekri, Sinhasa, Indore, Madhya Pradesh 452009</span>
                            </li>
                        </ul>
                        {/* Social Icons */}
                        <div className="flex gap-4 mt-4">
                            <a
                                href="https://www.instagram.com/protodesignstudio.3d/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex h-11 w-11 items-center justify-center rounded-full border bg-background transition-colors hover:border-primary/50"
                                aria-label="Follow us on Instagram"
                            >
                                <Instagram className="w-4 h-4" />
                            </a>
                            <a
                                href="https://www.youtube.com/@ProtoDesignStudio3d"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex h-11 w-11 items-center justify-center rounded-full border bg-background transition-colors hover:border-primary/50"
                                aria-label="Subscribe to our YouTube channel"
                            >
                                <Youtube className="w-4 h-4" />
                            </a>
                            <a
                                href="https://www.facebook.com/profile.php?id=61586266060055"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex h-11 w-11 items-center justify-center rounded-full border bg-background transition-colors hover:border-primary/50"
                                aria-label="Follow us on Facebook"
                            >
                                <Facebook className="w-4 h-4" />
                            </a>
                        </div>
                    </div>
                </div>

                <Separator className="my-8" />

                <div className="flex flex-col gap-4 text-xs text-foreground/80 md:flex-row md:items-center md:justify-between">
                    <p>© {new Date().getFullYear()} Zon Robotics and AI Pvt. Ltd. (CIN U72100MP2025PTC077687, GSTIN 23AACCZ6818Q1ZO). ProtoDesign is a brand of Zon Robotics and AI Pvt. Ltd.</p>
                    {/* Each claim here must match the shipping policy and checkout. */}
                    {/* Stacked on phones; one line with dot separators from md, drawn by CSS so a wrap never leaves one dangling. */}
                    <ul className="flex flex-col gap-1 md:flex-row md:flex-wrap md:gap-x-4 md:[&>li+li]:before:mr-4 md:[&>li+li]:before:content-['•']">
                        <li>Pay via PhonePe or cash on delivery</li>
                        <li>Dispatched in 2–3 business days</li>
                        <li>Email replies within 24 hours</li>
                    </ul>
                </div>
            </div>
        </footer>
    );
};