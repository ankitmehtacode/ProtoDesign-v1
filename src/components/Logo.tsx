import React from 'react';

export const Logo = ({ className = "w-9 h-9" }: { className?: string }) => {
    return (
        <div className={`${className} flex items-center justify-center`}>
            <svg
                viewBox="0 0 512 512"
                className="w-full h-full shadow-sm rounded-2xl"
                xmlns="http://www.w3.org/2000/svg"
            >
                <defs>
                    {/* References the same --primary/--accent tokens as the rest of
                        the UI (src/index.css) instead of hardcoded hex. Was three
                        standalone hex stops with no connection to the design system --
                        the last palette change (terracotta -> mint/pine) left the logo
                        behind since nothing tied it to the tokens. This way the logo
                        repaints automatically the next time the palette does too. */}
                    <linearGradient id="logoWarmGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" style={{ stopColor: 'hsl(var(--primary-glow))', stopOpacity: 1 }} />
                        <stop offset="50%" style={{ stopColor: 'hsl(var(--primary))', stopOpacity: 1 }} />
                        <stop offset="100%" style={{ stopColor: 'hsl(var(--accent))', stopOpacity: 1 }} />
                    </linearGradient>
                </defs>

                {/* Background: Rounded Square with Brand Gradient */}
                <rect x="0" y="0" width="512" height="512" rx="128" fill="url(#logoWarmGrad)" />

                {/* Part 1: The Vertical Stem (White) */}
                <rect x="130" y="100" width="90" height="312" rx="20" fill="white" />

                {/* Part 2: The Loop Component (White) */}
                <path
                    d="M 240 100 H 290 A 110 110 0 0 1 290 320 H 240 V 240 H 290 A 30 30 0 0 0 290 180 H 240 V 100 Z"
                    fill="white"
                />
            </svg>
        </div>
    );
};