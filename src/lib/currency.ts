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
 * GST (18%) contained in a GST-inclusive amount. Listed prices include GST;
 * mirrors gstIncludedPaise in backend/src/services/order.service.js.
 */
export const gstIncluded = (grossInr: number): number =>
  (Math.round(grossInr * 100) - Math.round((grossInr * 100) / 1.18)) / 100;
