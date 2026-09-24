import { ProductCatalog } from '@/components/shop/ProductCatalog';

interface CategoryPageProps {
    category: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    subCategories?: string[];
}

const CategoryPage = ({ category, eyebrow, title, subtitle, subCategories }: CategoryPageProps) => (
    <ProductCatalog category={category} eyebrow={eyebrow} title={title} subtitle={subtitle} subCategories={subCategories} />
);

export default CategoryPage;
