/** A hotend in profile: heat-break, cooling fins, heater block, brass nozzle with a hot tip. */
export const Nozzle = ({ className = "" }: { className?: string }) => (
    <svg viewBox="0 0 40 64" aria-hidden className={className}>
        <rect x="17" y="0" width="6" height="10" fill="hsl(0 0% 96%)" stroke="hsl(220 6% 70%)" strokeWidth="1" />
        {Array.from({ length: 6 }, (_, i) => (
            <rect key={i} x="6" y={10 + i * 4.2} width="28" height="2.6" rx="1" fill="hsl(210 8% 62%)" />
        ))}
        <rect x="15" y="10" width="10" height="25" fill="hsl(210 8% 52%)" />
        <rect x="8" y="36" width="24" height="14" rx="1.5" fill="hsl(210 8% 72%)" />
        <rect x="8" y="36" width="24" height="2" fill="white" fillOpacity="0.5" />
        <path d="M14 50 H26 V54 H14 Z" fill="hsl(41 62% 47%)" />
        <path d="M14 54 H26 L21.5 63 H18.5 Z" fill="hsl(44 70% 55%)" />
        <circle cx="20" cy="63.5" r="2.2" fill="hsl(28 100% 60%)" />
    </svg>
);
