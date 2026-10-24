// Types for faq.js (plain JS so the Node prerender script can import it).
export const FACTS: {
    shippingOnlineInr: number;
    shippingCodInr: number;
    codLimitInr: number;
    dispatchDays: string;
    deliveryMetroDays: string;
    deliveryRestDays: string;
    deliveryRemoteDays: string;
    returnWindowDays: number;
};
export const FAQ: { q: string; a: string }[];
export function faqLd(entries?: { q: string; a: string }[], path?: string): object;
export function printerPriceFaq(products: {
    name: string; price: number | string; stock: number; category?: string; sub_category?: string | null; specifications?: unknown; is_archived?: boolean;
    festival?: { name: string; ends_at: string; gift?: { label: string } } | null;
}[]): { q: string; a: string }[];
