import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { ProductCatalog } from '@/components/shop/ProductCatalog';
import { INTEREST_FOR_CATEGORY, LeadCapture } from '@/components/LeadCapture';
import { Faq } from '@/components/Faq';
import type { Product } from '@/components/shop/product';
import { printerPriceFaq } from '@/seo/faq.js';
import { PRINTER_CATEGORY } from '@/seo/site.js';
import { resolveComparisons } from '@/seo/guides.js';

interface CategoryPageProps {
    category: string;
    eyebrow: string;
    title: string;
    subtitle: string;
    subCategories?: string[];
}

// A self-serve answer before the enquiry form.
const TOOL_LINKS: Record<string, { to: string; title: string; body: string }[]> = {
    '3d_printer': [
        { to: '/printer-advisor', title: 'Which printer should you buy?', body: 'Answer three questions, get the best three in stock.' },
        { to: '/compare', title: 'Compare printers side by side', body: 'Printers people often choose between: price, specs and which to buy.' },
    ],
    filament: [{ to: '/filament-calculator', title: 'How much filament do you use?', body: 'See your monthly use, spool life and cost.' }],
};

/** The comparisons /printers links to, the same list its prerendered HTML carries. */
function PrinterComparisons({ products }: { products: Product[] }) {
    const comparisons = resolveComparisons(products);
    if (!comparisons.length) return null;
    return (
        <section className="mx-auto mt-12 max-w-3xl">
            <h2 className="text-xl font-bold">Compare 3D printers</h2>
            <ul className="mt-3 space-y-1 text-sm">
                {comparisons.map((r) => <li key={r.path}><Link className="hover:text-primary" to={r.path}>{r.cmp.a.name} vs {r.cmp.b.name}</Link></li>)}
            </ul>
        </section>
    );
}

const CategoryPage = ({ category, eyebrow, title, subtitle, subCategories }: CategoryPageProps) => {
    const interest = INTEREST_FOR_CATEGORY[category];
    return (
        <>
            <ProductCatalog
                category={category}
                eyebrow={eyebrow}
                title={title}
                subtitle={subtitle}
                subCategories={subCategories}
                footer={category === PRINTER_CATEGORY
                    ? (products) => <>
                        <Faq items={printerPriceFaq(products)} heading="3D printer prices in India: common questions" />
                        <PrinterComparisons products={products} />
                    </>
                    : undefined}
            />
            {interest && (
                <div className="container mx-auto max-w-4xl space-y-4 px-4 pb-16">
                    {TOOL_LINKS[category]?.map((tool) => (
                        <Link key={tool.to} to={tool.to} className="flex items-center justify-between gap-4 rounded-xl border bg-card p-5 hover:border-foreground/40">
                            <span><span className="font-semibold">{tool.title}</span>
                                <span className="block text-sm text-muted-foreground">{tool.body}</span></span>
                            <ArrowRight className="h-5 w-5 shrink-0" />
                        </Link>
                    ))}
                    <LeadCapture interest={interest} form="category_page" />
                </div>
            )}
        </>
    );
};

export default CategoryPage;
