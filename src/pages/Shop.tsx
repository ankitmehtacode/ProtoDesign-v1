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
        title="Shop"
        subtitle="Printers, materials and parts. Filter fast, add in one tap."
        categories={CATEGORIES}
    />
);

export default Shop;
