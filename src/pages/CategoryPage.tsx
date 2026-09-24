import { ProductCatalog } from '@/components/shop/ProductCatalog';

interface CategoryPageProps {
    category: string;
    title: string;
    subtitle: string;
    subCategories?: string[];
}

const CategoryPage = ({ category, title, subtitle, subCategories }: CategoryPageProps) => (
    <ProductCatalog category={category} title={title} subtitle={subtitle} subCategories={subCategories} />
);

export default CategoryPage;
