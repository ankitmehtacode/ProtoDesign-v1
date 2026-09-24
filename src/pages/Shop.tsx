import { CategoryOption, ProductCatalog } from '@/components/shop/ProductCatalog';

const CATEGORIES: CategoryOption[] = [
    { value: '3d_printer', label: 'Printers', subCategories: ['FDM', 'SLA', 'Metal 3D Printer', '3D Pen', 'Others'] },
    { value: 'filament', label: 'Filaments', subCategories: ['ABS', 'PETG', 'PLA', 'Carbon Fiber', 'Nylon Fiber', 'Others'] },
    { value: 'resin', label: 'Resins', subCategories: ['Standard', 'Water-Washable', 'Tough', 'Others'] },
    { value: '3dprintables', label: 'Printables' },
    { value: 'accessory', label: 'Accessories' },
    { value: 'spare_part', label: 'Spare parts' },
];

const Shop = () => (
    <ProductCatalog
        eyebrow="Shop"
        title="Everything we print with."
        subtitle="Printers, filament, resin and the parts that keep them running."
        categories={CATEGORIES}
    />
);

export default Shop;
