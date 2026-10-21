import { ProductCatalog } from '@/components/shop/ProductCatalog';
import { INTEREST_FOR_CATEGORY, LeadCapture } from '@/components/LeadCapture';

interface CategoryPageProps {
    category: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    subCategories?: string[];
}

const CategoryPage = ({ category, eyebrow, title, subtitle, subCategories }: CategoryPageProps) => {
    const interest = INTEREST_FOR_CATEGORY[category];
    return (
        <>
            <ProductCatalog category={category} eyebrow={eyebrow} title={title} subtitle={subtitle} subCategories={subCategories} />
            {interest && (
                <div className="container mx-auto max-w-4xl px-4 pb-16">
                    <LeadCapture interest={interest} form="category_page" />
                </div>
            )}
        </>
    );
};

export default CategoryPage;
