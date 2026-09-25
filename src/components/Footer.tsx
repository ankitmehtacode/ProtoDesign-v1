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
                        <ul className="space-y-2 text-sm text-foreground/80">
                            <li><Link to="/printers" className="hover:text-primary transition-colors">3D Printers</Link></li>
                            <li><Link to="/filaments" className="hover:text-primary transition-colors">Filaments</Link></li>
                            <li><Link to="/resins" className="hover:text-primary transition-colors">Resins</Link></li>
                            <li><Link to="/custom" className="hover:text-primary transition-colors">Custom Printing</Link></li>
                        </ul>
                    </div>

                    {/* Column 3: Legal & Support */}
                    <div>
                        <h3 className="font-semibold mb-4">Support</h3>
                        <ul className="space-y-2 text-sm text-foreground/80">
                            <li><Link to="/orders" className="hover:text-primary transition-colors">Track Order</Link></li>
                            <li><Link to="/terms-and-conditions" className="hover:text-primary transition-colors">Terms & Conditions</Link></li>
                            <li><Link to="/privacy-policy" className="hover:text-primary transition-colors">Privacy Policy</Link></li>
                            <li><Link to="/return-policy" className="hover:text-primary transition-colors">Return Policy</Link></li>
                            <li><Link to="/refund-policy" className="hover:text-primary transition-colors">Refund Policy</Link></li>
                            <li><Link to="/shipping-policy" className="hover:text-primary transition-colors">Shipping Policy</Link></li>
                            <li><Link to="/contact" className="hover:text-primary transition-colors">Contact Us</Link></li>
                        </ul>
                    </div>

                    {/* Column 4: Contact */}
                    <div>
                        <h3 className="font-semibold mb-4">Contact Us</h3>
                        <ul className="space-y-3 text-sm text-foreground/80">
                            <li className="flex items-center gap-2">
                                <Mail className="w-4 h-4 text-primary" />
                                <a href="mailto:help@protodesignstudio.com" className="hover:text-primary">help@protodesignstudio.com</a>
                            </li>
                            <li className="flex items-center gap-2">
                                <Phone className="w-4 h-4 text-primary" />
                                <a href="tel:+918249581682" className="hover:text-primary">+91 8249581682</a>
                            </li>
                            {whatsapp?.enabled && whatsapp.chatUrl && (
                                <li className="flex items-center gap-2">
                                    <FaWhatsapp className="w-4 h-4 text-primary" />
                                    <a href={whatsapp.chatUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary">Chat with ProtoDesign</a>
                                </li>
                            )}
                            <li className="flex items-start gap-2">
                                <MapPin className="w-4 h-4 text-primary mt-0.5" />
                                <span>I2, Gymnasia, Almas Amber, Kanupriya Nagar, Rau, Indore, Madhya Pradesh 453331</span>
                            </li>
                        </ul>
                        {/* Social Icons */}
                        <div className="flex gap-4 mt-4">
                            <a
                                href="https://www.instagram.com/protodesignstudio.3d/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 bg-background rounded-full border hover:border-primary/50 transition-colors"
                                aria-label="Follow us on Instagram"
                            >
                                <Instagram className="w-4 h-4" />
                            </a>
                            <a
                                href="https://www.youtube.com/@ProtoDesignStudio3d"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 bg-background rounded-full border hover:border-primary/50 transition-colors"
                                aria-label="Subscribe to our YouTube channel"
                            >
                                <Youtube className="w-4 h-4" />
                            </a>
                            <a
                                href="https://www.facebook.com/profile.php?id=61586266060055"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-2 bg-background rounded-full border hover:border-primary/50 transition-colors"
                                aria-label="Follow us on Facebook"
                            >
                                <Facebook className="w-4 h-4" />
                            </a>
                        </div>
                    </div>
                </div>

                <Separator className="my-8" />

                <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-foreground/80">
                    <p>© {new Date().getFullYear()} Zon Robotics and AI Pvt. Ltd. ProtoDesign is a brand of Zon Robotics and AI Pvt. Ltd.</p>
                    {/* Each claim here must match the shipping policy and checkout. */}
                    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
                        <span>Pay via PhonePe or cash on delivery</span>
                        <span>•</span>
                        <span>Dispatched in 2–3 business days</span>
                        <span>•</span>
                        <span>Email replies within 24 hours</span>
                    </div>
                </div>
            </div>
        </footer>
    );
};