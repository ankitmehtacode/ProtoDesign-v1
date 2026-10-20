// The 2026 Navratri and Diwali sales, as the festival tests' schedule. Production
// runs none (src/services/festival.js); these keep the pricing rules covered.
export const TEST_SALES = Object.freeze([
    {
        id: 'navratri-2026', name: 'Navratri Sale', percentOff: 5, category: '3d_printer',
        startsAt: '2026-10-11T00:00:00+05:30', endsAt: '2026-10-21T00:00:00+05:30',
    },
    {
        id: 'diwali-2026', name: 'Diwali Sale', percentOff: 3, category: '3d_printer',
        startsAt: '2026-10-21T00:00:00+05:30', endsAt: '2026-11-12T00:00:00+05:30',
    },
].map(Object.freeze));
