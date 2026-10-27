// Types for guides.js (plain JS so the Node prerender script can import it).
export type Side = { slug: string; name: string };
export type Comparison = { slug: string; a: Side; b: Side; intro: string; chooseA: string; chooseB: string };
type Comparable = { slug?: string; id: string; name: string; is_archived?: boolean; price: number | string };
export type ResolvedComparison<P extends Comparable> = { cmp: Comparison; a: P; b: P; path: string };
export type UseCase = {
    slug: string; title: string; description: string; h1: string; name: string; intro: string;
    sections: { heading: string; body: string[] }[];
    materials: { material: string; use: string }[];
    example: { label: string; cm3: number };
    faq: { q: string; a: string }[];
};
type Hub = { path: string; title: string; description: string; h1: string; intro: string };

export const COMPARISONS: Comparison[];
export function comparePath(c: Comparison): string;
export function resolveComparisons<P extends Comparable>(products: P[]): ResolvedComparison<P>[];
export function compareTitle(c: Comparison): string;
export function compareDescription(r: ResolvedComparison<Comparable>): string;
export function compareLd(r: ResolvedComparison<Comparable>): object[];
export const COMPARE_CRUMBS: { name: string; path: string }[];
export const COMPARE_HUB: Hub;
export function compareHubLd(): object[];

export const USE_CASES: UseCase[];
export function casePath(u: UseCase): string;
export function caseCrumbs(u: UseCase): { name: string; path: string }[];
export function caseLd(u: UseCase): object[];
export const USE_CASE_HUB: Hub;
export function caseHubLd(): object[];
export function casePageLd(u: UseCase): object[];
