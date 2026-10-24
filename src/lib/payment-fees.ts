/**
 * How an online order is paid and its convenience fee: basis points of items +
 * shipping, rounded to whole rupees. Mirrors PAYMENT_FEE_BPS and
 * convenienceFeePaise in backend/src/services/order.service.js, which is what
 * is charged; change both together.
 */
export type PaymentMethod = "upi" | "net_banking" | "debit_card" | "credit_card";

export const PAYMENT_FEE_BPS: Record<PaymentMethod, number> = { upi: 0, net_banking: 0, debit_card: 150, credit_card: 250 };

/** Rupees in, whole rupees out. */
export const convenienceFee = (amount: number, method: PaymentMethod) =>
    Math.round((Math.round(amount * 100) * PAYMENT_FEE_BPS[method]) / 1_000_000);

/** "2.5%" */
export const feePercent = (method: PaymentMethod) => `${PAYMENT_FEE_BPS[method] / 100}%`;
