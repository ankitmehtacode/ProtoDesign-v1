import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Wallet, Banknote, CreditCard, ShieldCheck } from 'lucide-react';
import { formatINR } from '@/lib/currency';

interface PaymentGateway {
    id: string;
    name: string;
    description: string;
    icon: React.ReactNode;
}

interface PaymentGatewaySelectorProps {
    amount: number;
    onSelect: (gatewayId: string) => void;
    selected?: string;
    showCOD?: boolean; // Prop to hide COD for printers
}

export const PaymentGatewaySelector = ({
    amount,
    onSelect,
    selected,
    showCOD = true,
}: PaymentGatewaySelectorProps) => {
    const [selectedGateway, setSelectedGateway] = useState(selected || 'phonepe');

    // ✅ FIX: Sync internal state with parent changes
    // This is crucial because if Checkout.tsx dynamically disables COD, 
    // it will force the selection back to 'phonepe', and we need the UI to reflect that.
    useEffect(() => {
        if (selected) {
            setSelectedGateway(selected);
        }
    }, [selected]);

    useEffect(() => {
        if (!selected) {
            onSelect('phonepe');
        }
    }, []);

    const handleSelect = (gatewayId: string) => {
        setSelectedGateway(gatewayId);
        onSelect(gatewayId);
    };

    const PAYMENT_GATEWAYS: PaymentGateway[] = [
        {
            id: 'phonepe',
            name: 'PhonePe (Online)',
            description: 'UPI, Cards, Net Banking',
            icon: <CreditCard className="w-6 h-6 text-purple-600" />,
        }
    ];

    // Only add COD if permitted
    if (showCOD) {
        PAYMENT_GATEWAYS.push({
            id: 'cod',
            name: 'Cash on Delivery',
            description: 'Pay when your order arrives',
            icon: <Banknote className="w-6 h-6 text-green-600" />,
        });
    }

    return (
        <div className="space-y-6">
            <div className="text-center bg-slate-50 p-4 rounded-xl border border-dashed border-slate-200">
                <h3 className="text-xl font-bold flex items-center justify-center gap-2">
                    <ShieldCheck className="text-primary w-5 h-5" /> Select Payment Method
                </h3>
                <p className="text-muted-foreground mt-1 text-sm">
                    Final Amount: <span className="font-bold text-primary">{formatINR(amount)}</span>
                </p>
            </div>

            <RadioGroup value={selectedGateway} onValueChange={handleSelect}>
                <div className="grid gap-4">
                    {PAYMENT_GATEWAYS.map((gateway) => (
                        <Card
                            key={gateway.id}
                            className={`p-5 cursor-pointer transition-all border-2 ${
                                selectedGateway === gateway.id
                                    ? 'border-primary bg-primary/[0.02] shadow-sm'
                                    : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'
                            }`}
                            onClick={() => handleSelect(gateway.id)}
                        >
                            <div className="flex items-start gap-4">
                                <RadioGroupItem
                                    value={gateway.id}
                                    id={gateway.id}
                                    className="mt-1"
                                />
                                <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-1">
                                        <div className="p-2 bg-white rounded-lg shadow-sm">{gateway.icon}</div>
                                        <Label
                                            htmlFor={gateway.id}
                                            className="text-lg font-bold cursor-pointer"
                                        >
                                            {gateway.name}
                                        </Label>
                                    </div>
                                    <p className="text-sm text-muted-foreground pl-12">
                                        {gateway.description}
                                    </p>
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            </RadioGroup>
        </div>
    );
};
