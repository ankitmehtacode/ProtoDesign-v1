import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import DriftWall from "@/components/DriftWall/DriftWall";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";

gsap.registerPlugin(ScrollTrigger);

// TODO: placeholder photos pulled from Pinterest for local preview only —
// swap for licensed/owned product photography before shipping to production.
const heroWallItems = [
  { image: "https://i.pinimg.com/736x/cd/7f/75/cd7f75aa977dc8f1eee6ef916c8bb2fe.jpg", title: "Geek shelf decor" },
  { image: "https://i.pinimg.com/736x/18/0e/19/180e197518e13dae1cd1bd5ac3cda684.jpg", title: "Rustic headphone stand" },
  { image: "https://i.pinimg.com/736x/32/c0/f5/32c0f5b832ffe8305ff933423ddaf2f7.jpg", title: "Custom controller shell" },
  { image: "https://i.pinimg.com/736x/86/b0/4b/86b04b33c14c7bc612c39744f05f4ed2.jpg", title: "Hexagon display shelf" },
  { image: "https://i.pinimg.com/736x/cf/e6/17/cfe6172d2638ec2b601a29c64bffaff6.jpg", title: "Taurus sculpture" },
  { image: "https://media.sketchfab.com/models/d30c32d54aca476a8e817345580c6aaa/thumbnails/0a544d9a986f47cdaf80acf19912a9da/4364a6e547f845f38f9e524389acfa84.jpeg", title: "Majestic sword, game-ready" },
];

export const Hero = () => {
  const heroRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!heroRef.current || !imageRef.current || !contentRef.current) return;

    // Parallax effect for the image
    gsap.to(imageRef.current, {
      y: 100,
      ease: "none",
      scrollTrigger: {
        trigger: heroRef.current,
        start: "top top",
        end: "bottom top",
        scrub: 1,
      },
    });

    // Parallax effect for content (slower than image)
    gsap.to(contentRef.current, {
      y: 50,
      opacity: 0.5,
      ease: "none",
      scrollTrigger: {
        trigger: heroRef.current,
        start: "top top",
        end: "bottom top",
        scrub: 1,
      },
    });
  }, []);

  return (
    <div ref={heroRef} className="relative min-h-screen flex items-center overflow-hidden">
      {/* Background Image with Parallax */}
        <div
            ref={imageRef}
            className="absolute inset-0 w-full h-[120%] -top-[10%]"
        >
            <div className="absolute inset-0 bg-gradient-to-r from-background/95 via-background/70 to-transparent z-10" />
            <DriftWall
                items={heroWallItems}
                columns={6}
                tileWidth={220}
                tileHeight={150}
                speed={30}
                dim={0.92}
            />
        </div>

      {/* Content */}
      <div ref={contentRef} className="container mx-auto px-4 relative z-20 pt-20">
        <div className="max-w-3xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
          >
            <h1 className="font-display text-6xl md:text-7xl lg:text-8xl mb-6 leading-tight">
              High-Fidelity
              <br />
              in Every Shade
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            className="text-xl md:text-2xl text-muted-foreground mb-10 max-w-2xl"
          >
            Premium 3D printing services with cutting-edge technology.
            Shop high-end printers or get instant quotes for custom prints.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
            className="flex flex-col sm:flex-row gap-4"
          >
            <Link to="/custom">
              <Button variant="hero" size="lg" className="group">
                Get Custom Quote
                <ArrowRight className="transition-transform group-hover:translate-x-1" />
              </Button>
            </Link>
            <Link to="/shop">
              <Button variant="outline" size="lg" className="shadow-soft">
                Shop Printers
              </Button>
            </Link>
          </motion.div>
        </div>
      </div>

      {/* Bottom Gradient Fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent z-10" />
    </div>
  );
};
