import navratri from '@/assets/festival/navratri.webp';
import diwali from '@/assets/festival/diwali.webp';

/**
 * The photo behind each sale's banner, by the sale id's prefix in the server
 * schedule (backend/src/services/festival.js). A sale without one gets the
 * plain dark banner. Sources and licences: src/assets/festival/CREDITS.md.
 */
const ART: Record<string, string> = { navratri, diwali };

export const festivalArt = (saleId: string): string | undefined => ART[saleId.split('-')[0]];
