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
export function faqLd(): object;
