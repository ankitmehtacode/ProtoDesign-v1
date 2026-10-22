import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Banknote, CreditCard, Landmark, QrCode, ShieldCheck } from 'lucide-react';
import { formatINR } from '@/lib/currency';
import { convenienceFee, feePercent, type PaymentMethod } from '@/lib/payment-fees';

/** A payment method, or cash on delivery. */
export type PaymentChoice = PaymentMethod | 'cod';

interface PaymentGatewaySelectorProps {
    /** Items + shipping, before any convenience fee. */
    amount: number;
    onSelect: (choice: PaymentChoice) => void;
    selected: PaymentChoice;
    showCOD?: boolean;
}

/**
 * How the customer pays. Every fee is shown here, in rupees, before they
 * choose; the server charges exactly this (order.service.js) and PhonePe then
 * offers only the chosen method.
 */
export const PaymentGatewaySelector = ({ amount, onSelect, selected, showCOD = true }: PaymentGatewaySelectorProps) => {
    const cardFee = (method: PaymentMethod) =>
        `${feePercent(method)} convenience fee: ${formatINR(convenienceFee(amount, method))}.`;

    const options: { id: PaymentChoice; name: string; description: string; tag?: string; icon: React.ReactNode }[] = [
        {
            id: 'upi',
            name: 'UPI or QR code',
            description: amount > 100000
                ? 'Any UPI app, or scan a QR code. No fee. Many banks cap UPI at ₹1 lakh a payment, so net banking may suit this order better.'
                : 'Google Pay, PhonePe, Paytm, BHIM or any UPI app, or scan a QR code. No convenience fee.',
            tag: 'No fee',
            icon: <QrCode className="w-6 h-6 text-green-300" />,
        },
        {
            id: 'net_banking',
            name: 'Net banking',
            description: 'Pay from your bank account, with no limit on the amount. No convenience fee.',
            tag: 'No fee',
            icon: <Landmark className="w-6 h-6 text-green-300" />,
        },
        {
            id: 'debit_card',
            name: 'Debit card',
            description: cardFee('debit_card'),
            icon: <CreditCard className="w-6 h-6 text-purple-300" />,
        },
        {
            id: 'credit_card',
            name: 'Credit card',
            description: cardFee('credit_card'),
            icon: <CreditCard className="w-6 h-6 text-purple-300" />,
        },
    ];
    if (showCOD) {
        options.push({
            id: 'cod',
            name: 'Cash on Delivery',
            description: 'Pay when your order arrives',
            icon: <Banknote className="w-6 h-6 text-green-300" />,
        });
    }

    return (
        <div className="space-y-6">
            <div className="text-center bg-muted/30 p-4 rounded-xl border border-dashed border-border">
                <h3 className="text-xl font-bold flex items-center justify-center gap-2">
                    <ShieldCheck className="text-primary w-5 h-5" /> Select Payment Method
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">UPI and net banking have no convenience fee. Cards add a small fee, shown before you pay.</p>
            </div>

            <RadioGroup value={selected} onValueChange={(v) => onSelect(v as PaymentChoice)}>
                <div className="grid gap-4">
                    {options.map((option) => (
                        <Card
                            key={option.id}
                            className={`p-5 cursor-pointer transition-all border-2 ${
                                selected === option.id
                                    ? 'border-primary bg-primary/[0.02] shadow-sm'
                                    : 'border-border hover:border-border hover:bg-muted/30'
                            }`}
                            onClick={() => onSelect(option.id)}
                        >
                            <div className="flex items-start gap-4">
                                <RadioGroupItem value={option.id} id={`pay-${option.id}`} className="mt-1" />
                                <div className="flex-1">
                                    <div className="flex flex-wrap items-center gap-3 mb-1">
                                        <div className="p-2 bg-card rounded-lg shadow-sm">{option.icon}</div>
                                        <Label htmlFor={`pay-${option.id}`} className="text-lg font-bold cursor-pointer">
                                            {option.name}
                                        </Label>
                                        {option.tag && (
                                            <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-300">{option.tag}</span>
                                        )}
                                    </div>
                                    <p className="text-sm text-muted-foreground pl-12">{option.description}</p>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </RadioGroup>
        </div>
    );
};
