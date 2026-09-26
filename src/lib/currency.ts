/**
 * Format currency in Indian Rupees
 */
export const formatINR = (amount: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

/**
 * Convert USD to INR (approximate rate: 1 USD = 83 INR)
 * This is a placeholder - in production, you'd use real-time exchange rates
 */
export const usdToINR = (usd: number): number => {
  return Math.round(usd * 83);
};

/**
 * GST (18%) contained in a GST-inclusive amount. Listed prices include GST;
 * mirrors gstIncludedPaise in backend/src/services/order.service.js.
 */
export const gstIncluded = (grossInr: number): number =>
  (Math.round(grossInr * 100) - Math.round((grossInr * 100) / 1.18)) / 100;

/**
 * Material pricing in INR per gram
 */
export const MATERIAL_PRICES = {
  PLA: 2.5,
  ABS: 3.0,
  PETG: 3.5,
  TPU: 5.0,
  Nylon: 6.0,
  'Wood Fill': 4.5,
  'Carbon Fiber': 8.0,
  Resin: 7.0,
} as const;

export type MaterialType = keyof typeof MATERIAL_PRICES;
