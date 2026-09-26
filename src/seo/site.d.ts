// Types for site.js, which stays plain JS so the Node prerender script can import it.
export type Crumb = { name: string; path: string };
export type PageMeta = {
    title: string; description: string; h1?: string; intro?: string;
    noindex?: boolean; crumbs?: Crumb[]; service?: boolean; category?: string;
};
type ProductInput = {
    name: string; slug?: string; id: string; description?: string; short_description?: string;
    price: number | string; stock: number; image_url?: string | null; images?: string[]; category?: string;
    specifications?: unknown;
};
export const SITE_URL: string;
export const SITE_NAME: string;
export const DEFAULT_IMAGE: string;
export const ORG: Record<string, unknown>;
export const PAGES: Record<string, PageMeta>;
export const NOT_FOUND: PageMeta;
export const CATEGORY_PAGES: Record<string, [string, string]>;
export function organizationLd(): object;
export function websiteLd(): object;
export function breadcrumbLd(crumbs: Crumb[]): object;
export function quoteServiceLd(): object;
export function productLd(p: ProductInput, categoryName: string, categoryPath: string): object[];
export function productUrl(p: { slug?: string; id: string }): string;
export function specMap(specs: unknown): Record<string, string>;
export function plainText(s?: string, max?: number): string;
export function productTitle(name: string, categoryName: string): string;
export function productDescription(p: { name: string; price: number | string; short_description?: string; description?: string }): string;
