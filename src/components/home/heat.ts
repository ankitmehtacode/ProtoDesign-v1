/** Heat colour: brand mint when cool, through amber to ember, white-hot at the top. */
export function heat(t: number) {
    const f = Math.min(1, t / 250);
    const stops = [
        [0, 152, 55, 55],
        [0.45, 38, 95, 55],
        [0.75, 22, 95, 55],
        [1, 45, 100, 88],
    ];
    const i = Math.max(1, stops.findIndex((s) => s[0] >= f));
    const [f0, h0, s0, l0] = stops[i - 1];
    const [f1, h1, s1, l1] = stops[i];
    const k = (f - f0) / (f1 - f0 || 1);
    return `hsl(${h0 + (h1 - h0) * k} ${s0 + (s1 - s0) * k}% ${l0 + (l1 - l0) * k}%)`;
}

/**
 * Each HeatMeter registers its controls on its own <svg>, so the ladder's scroll
 * timeline can fire a meter without re-rendering React on every rung.
 */
export type MeterControls = {
    /** Charge from empty, with the impact. */
    play(): void;
    /** Empty and still, ready to charge. */
    empty(): void;
    /** Full and still (no motion). */
    fill(): void;
};

const meters = new WeakMap<Element, MeterControls>();

export const registerMeter = (el: Element, controls: MeterControls) => {
    meters.set(el, controls);
    return () => meters.delete(el);
};

export const meter = (el: Element) => meters.get(el);
