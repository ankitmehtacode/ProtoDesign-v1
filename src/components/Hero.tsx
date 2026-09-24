import { useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { gsap, refreshInPageOrder } from "@/lib/gsap";
import DriftWall from "@/components/DriftWall/DriftWall";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import TechText from "./animations/TechText";

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

  useLayoutEffect(() => {
    if (!heroRef.current || !imageRef.current || !contentRef.current) return;

    // Scoped context: without revert() every visit to "/" stacked another pair
    // of ScrollTriggers on detached nodes.
    const ctx = gsap.context(() => {
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
    }, heroRef);
    refreshInPageOrder();

    return () => ctx.revert();
  }, []);

  return (
    <div ref={heroRef} className="relative flex min-h-[100svh] items-center overflow-hidden bg-[hsl(28_12%_7%)] text-[hsl(40_20%_94%)]">
      {/* Background: the drift wall under a dark scrim, darkest where the headline sits. */}
      <div ref={imageRef} className="absolute inset-0 -top-[10%] h-[120%] w-full">
        <div className="absolute inset-0 z-10 bg-[radial-gradient(ellipse_70%_55%_at_50%_48%,hsl(28_12%_7%/0.94),hsl(28_12%_7%/0.78)_60%,hsl(28_12%_7%/0.55))]" />
        <DriftWall items={heroWallItems} columns={6} tileWidth={220} tileHeight={150} speed={30} dim={0.92} />
      </div>

      <div ref={contentRef} className="container relative z-20 mx-auto px-4 pt-20 text-center">


        <Headline />

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
          className="mx-auto max-w-xl text-base leading-relaxed text-white/70 sm:text-lg"
        >
          Upload a 3D model, get a price in seconds, and we print it and ship it anywhere in India.
          Or get the printer and make it yourself.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.45, ease: "easeOut" }}
          className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"
        >
          {/* Green-tinted glass: the tint keeps it the primary action next to the
              neutral outline button, while the drift wall stays visible through it. */}
          <Link
            to="/custom"
            className="group relative isolate inline-flex min-h-12 items-center justify-center gap-2 overflow-hidden rounded-full border border-[#00ce64]/45 bg-[#00ce64]/20 px-7 font-semibold text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_8px_32px_-8px_rgb(0_206_100/0.55)] backdrop-blur-xl backdrop-saturate-150 transition-[transform,background-color,box-shadow] duration-300 hover:bg-[#00ce64]/30 hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.4),0_10px_40px_-6px_rgb(0_206_100/0.75)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00ce64] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(28_12%_7%)] active:scale-95"
          >
            {/* Specular sheen across the top half, as light catches curved glass. */}
            <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />
            Get an instant quote
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <Link
            to="/printers"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 px-7 font-medium text-white/85 transition-colors hover:border-white/40"
          >
            Shop 3D printers
          </Link>
        </motion.div>

      </div>

      <div className="absolute bottom-0 left-0 right-0 z-10 h-24 bg-gradient-to-t from-[hsl(28_12%_11%)] to-transparent" />

      {/* The page's only h1, set as a quiet caption on the hero's bottom edge. It is
          real visible text (not hidden) so it can carry the searched-for words; the
          canvas headline above is aria-hidden, so its words are included here too. */}
      <h1 className="absolute bottom-5 left-0 right-0 z-20 px-4 text-center font-mono text-[10px] font-normal uppercase tracking-[0.18em] text-white/35 sm:bottom-7">
        <span className="sr-only">Make it real. </span>
        3D printing service &amp; 3D printers in India
      </h1>
    </div>
  );
};

/**
 * "Make it real." in React Bits' TechText (Geist 400, green with a red accent,
 * solid reveal lines). TechText centres one line in its box and shrinks it to
 * fit, so each line gets its own box and a shared font size from the measured
 * width: one line on wide screens, two on phones, same size throughout.
 */
function Headline() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width > 0 && width < 640;
  const lines = narrow ? ["Make it", "real."] : ["Make it real."];
  const fontSize = Math.round(narrow ? width * 0.26 : Math.min(width * 0.13, 200));

  return (
    <div ref={ref} aria-hidden className="mx-auto my-4 w-full max-w-6xl sm:my-6">
      {width > 0 &&
        lines.map((line) => (
          <div key={line} style={{ height: Math.round(fontSize * (narrow ? 1.05 : 1.35)) }}>
            <TechText
              text={line}
              fontFamily="Geist, sans-serif"
              fontWeight={400}
              fontSize={fontSize}
              color="#00ce64"
              accentColor="#8e2727"
              reveal="area"
              lineStyle="solid"
              specks={17}
              speed={1.3}
            />
          </div>
        ))}
    </div>
  );
}
