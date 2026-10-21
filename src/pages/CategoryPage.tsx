import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ProductCatalog } from '@/components/shop/ProductCatalog';
import { INTEREST_FOR_CATEGORY, LeadCapture } from '@/components/LeadCapture';

interface CategoryPageProps {
    category: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    subCategories?: string[];
}

// A self-serve answer before the enquiry form.
const TOOL_LINKS: Record<string, { to: string; title: string; body: string }> = {
    '3d_printer': { to: '/printer-advisor', title: 'Which printer should you buy?', body: 'Answer three questions, get the best three in stock.' },
    filament: { to: '/filament-calculator', title: 'How much filament do you use?', body: 'See your monthly use, spool life and cost.' },
};

const CategoryPage = ({ category, eyebrow, title, subtitle, subCategories }: CategoryPageProps) => {
    const interest = INTEREST_FOR_CATEGORY[category];
    return (
        <>
            <ProductCatalog category={category} eyebrow={eyebrow} title={title} subtitle={subtitle} subCategories={subCategories} />
            {interest && (
                <div className="container mx-auto max-w-4xl space-y-4 px-4 pb-16">
                    {TOOL_LINKS[category] && (
                        <Link to={TOOL_LINKS[category].to} className="flex items-center justify-between gap-4 rounded-xl border bg-card p-5 hover:border-foreground/40">
                            <span><span className="font-semibold">{TOOL_LINKS[category].title}</span>
                                <span className="block text-sm text-muted-foreground">{TOOL_LINKS[category].body}</span></span>
                            <ArrowRight className="h-5 w-5 shrink-0" />
                        </Link>
                    )}
                    <LeadCapture interest={interest} form="category_page" />
                </div>
            )}
        </>
    );
};

export default CategoryPage;
