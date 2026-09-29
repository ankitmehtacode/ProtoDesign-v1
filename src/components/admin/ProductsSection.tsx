import { useCallback, useEffect, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Archive, Download, ExternalLink, Pencil, Plus, RotateCcw, Search, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AdminProduct, LOW_STOCK, MAIN_CATEGORIES, SUB_CATEGORIES, downloadCsv, stockState } from "./model";
import { Empty, FilterPills, Kpi, PageHeader, StatusBadge } from "./ui";

type StockFilter = "all" | "live" | "low" | "out" | "archived";
const MAX_IMAGES = 7;
const COD_KEY = "allow_cod_override";

type Spec = { key: string; value: string };
type FormState = {
    name: string; description: string; short_description: string; price: string; stock: string;
    category: string; sub_category: string; specs: Spec[]; allow_cod_override: boolean;
};
type ImageItem = { id: string; url: string; file?: File };

const EMPTY: FormState = {
    name: "", description: "", short_description: "", price: "", stock: "",
    category: "filament", sub_category: "", specs: [], allow_cod_override: false,
};

/** Specs arrive as an object or a key/value list; COD override lives among them. */
function specsFrom(p: AdminProduct): { specs: Spec[]; cod: boolean } {
    const raw = p.specifications;
    const list: Spec[] = !raw ? [] : Array.isArray(raw)
        ? raw.map((s) => ({ key: s.key, value: String(s.value) }))
        : Object.entries(raw).map(([key, value]) => ({ key, value: String(value) }));
    const cod = list.some((s) => s.key === COD_KEY && s.value.toLowerCase() === "true");
    return { specs: list.filter((s) => s.key !== COD_KEY), cod };
}

export function ProductsSection({ products, initialFilter, onChanged }: {
    products: AdminProduct[]; initialFilter?: string; onChanged: () => void;
}) {
    const [q, setQ] = useState("");
    const [category, setCategory] = useState("all");
    const [stock, setStock] = useState<StockFilter>("live");
    const [editing, setEditing] = useState<AdminProduct | "new" | null>(null);

    useEffect(() => { if (initialFilter) setStock(initialFilter as StockFilter); }, [initialFilter]);

    const live = products.filter((p) => !p.is_archived);
    const stats = {
        live: live.length,
        value: live.reduce((s, p) => s + Number(p.price) * Math.max(0, p.stock), 0),
        out: live.filter((p) => stockState(p) === "out").length,
        low: live.filter((p) => stockState(p) === "low").length,
    };

    const base = useMemo(() => {
        const n = q.trim().toLowerCase();
        return products.filter((p) =>
            (category === "all" || p.category === category) &&
            (!n || [p.name, p.sub_category, p.category].some((v) => v && v.toLowerCase().includes(n))));
    }, [products, q, category]);

    const counts = {
        all: base.length,
        live: base.filter((p) => !p.is_archived).length,
        low: base.filter((p) => stockState(p) === "low").length,
        out: base.filter((p) => stockState(p) === "out").length,
        archived: base.filter((p) => p.is_archived).length,
    };
    const rows = base.filter((p) =>
        stock === "all" ? true : stock === "live" ? !p.is_archived : stock === "archived" ? !!p.is_archived : stockState(p) === stock);

    const toggleArchive = async (p: AdminProduct) => {
        const restoring = !!p.is_archived;
        if (!window.confirm(restoring ? `Put “${p.name}” back on sale?` : `Archive “${p.name}”? It disappears from the shop; you can restore it later.`)) return;
        try {
            if (restoring) await apiService.restoreProduct(p.id);
            else await apiService.deleteProduct(p.id);
            toast.success(restoring ? "Product restored" : "Product archived");
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "That didn't work");
        }
    };

    const exportCsv = () => downloadCsv(`products-${new Date().toISOString().slice(0, 10)}.csv`,
        ["ID", "Name", "Category", "Sub-category", "Price", "Stock", "Stock value", "Status"],
        rows.map((p) => [p.id, p.name, p.category, p.sub_category ?? "", Number(p.price), p.stock,
            Number(p.price) * Math.max(0, p.stock), p.is_archived ? "Archived" : "Live"]));

    return (
        <>
            <PageHeader
                title="Products"
                description="Catalogue, stock and listings."
                actions={
                    <>
                        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}><Download className="mr-2 h-4 w-4" />Export CSV</Button>
                        <Button size="sm" onClick={() => setEditing("new")}><Plus className="mr-2 h-4 w-4" />Add product</Button>
                    </>
                }
            />

            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Live listings" value={String(stats.live)} change={null} hint="on the shop now" />
                <Kpi label="Stock value" value={formatINR(stats.value)} change={null} hint="at list price" />
                <Kpi label="Out of stock" value={String(stats.out)} change={null} hint="can't be bought" />
                <Kpi label="Low stock" value={String(stats.low)} change={null} hint={`fewer than ${LOW_STOCK} left`} />
            </div>

            <div className="rounded-xl border bg-card">
                <div className="flex flex-col gap-3 border-b p-4">
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" className="pl-9" />
                        </div>
                        <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All categories</SelectItem>
                                {MAIN_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <FilterPills<StockFilter>
                        value={stock}
                        onChange={setStock}
                        options={[
                            { value: "live", label: "Live", count: counts.live, tone: "green" },
                            { value: "low", label: "Low stock", count: counts.low, tone: "amber" },
                            { value: "out", label: "Out of stock", count: counts.out, tone: "red" },
                            { value: "archived", label: "Archived", count: counts.archived, tone: "neutral" },
                            { value: "all", label: "All", count: counts.all },
                        ]}
                    />
                </div>

                {rows.length === 0 ? <Empty title="No products match" /> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                                <tr>
                                    <th className="px-4 py-2.5 font-medium">Product</th>
                                    <th className="px-4 py-2.5 font-medium">Category</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Price</th>
                                    <th className="px-4 py-2.5 text-right font-medium">Stock</th>
                                    <th className="px-4 py-2.5 font-medium">Status</th>
                                    <th className="px-4 py-2.5" />
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {rows.map((p) => {
                                    const st = stockState(p);
                                    const image = p.product_images?.slice().sort((a, b) => a.display_order - b.display_order)[0]?.image_url || p.image_url;
                                    return (
                                        <tr key={p.id} className="transition-colors hover:bg-muted/40">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-3">
                                                    <span className="h-11 w-11 shrink-0 overflow-hidden rounded-md border bg-card">
                                                        {image && <img src={image} alt="" className="h-full w-full object-contain" loading="lazy" />}
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block max-w-[22rem] truncate font-medium">{p.name}</span>
                                                        <span className="block max-w-[22rem] truncate text-xs text-muted-foreground">{p.short_description}</span>
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <div>{MAIN_CATEGORIES.find((c) => c.value === p.category)?.label ?? p.category}</div>
                                                {p.sub_category && <div className="text-xs text-muted-foreground">{p.sub_category}</div>}
                                            </td>
                                            <td className="px-4 py-3 text-right tabular-nums">{formatINR(Number(p.price))}</td>
                                            <td className={`px-4 py-3 text-right font-medium tabular-nums ${st === "out" ? "text-rose-300" : st === "low" ? "text-amber-300" : ""}`}>{p.stock}</td>
                                            <td className="px-4 py-3">
                                                {st === "archived" ? <StatusBadge label="Archived" tone="neutral" />
                                                    : st === "out" ? <StatusBadge label="Out of stock" tone="red" />
                                                        : st === "low" ? <StatusBadge label="Low stock" tone="amber" />
                                                            : <StatusBadge label="Live" tone="green" />}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex justify-end gap-1">
                                                    {!p.is_archived && (
                                                        <Button variant="ghost" size="icon" asChild title="View on the shop">
                                                            <a href={`/product/${p.slug || p.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" /></a>
                                                        </Button>
                                                    )}
                                                    {!p.is_archived && <Button variant="ghost" size="icon" onClick={() => setEditing(p)} title="Edit"><Pencil className="h-4 w-4" /></Button>}
                                                    <Button variant="ghost" size="icon" onClick={() => toggleArchive(p)} title={p.is_archived ? "Restore" : "Archive"}>
                                                        {p.is_archived ? <RotateCcw className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <ProductSheet product={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onChanged(); }} />
        </>
    );
}

function ProductSheet({ product, onClose, onSaved }: { product: AdminProduct | "new" | null; onClose: () => void; onSaved: () => void }) {
    const isNew = product === "new";
    const [form, setForm] = useState<FormState>(EMPTY);
    const [images, setImages] = useState<ImageItem[]>([]);
    const [video, setVideo] = useState<{ file?: File; url?: string | null }>({});
    const [saving, setSaving] = useState(false);

    // Load the product being edited (or a blank form) whenever the sheet opens.
    useEffect(() => {
        if (!product) return;
        if (product === "new") {
            setForm(EMPTY);
            setImages([]);
            setVideo({});
            return;
        }
        const { specs, cod } = specsFrom(product);
        setForm({
            name: product.name, description: product.description ?? "", short_description: product.short_description ?? "",
            price: String(product.price), stock: String(product.stock), category: product.category,
            sub_category: product.sub_category ?? "", specs, allow_cod_override: cod,
        });
        setImages((product.product_images ?? []).slice().sort((a, b) => a.display_order - b.display_order)
            .map((i) => ({ id: i.id, url: i.image_url || i.image_data || "" })).filter((i) => i.url));
        setVideo({ url: product.video_url ?? null });
    }, [product]);

    // Local previews are object URLs: release each when it leaves the form.
    const release = (list: ImageItem[]) => list.forEach((i) => i.file && URL.revokeObjectURL(i.url));
    useEffect(() => {
        if (!product) setImages((prev) => { release(prev); return []; });
    }, [product]);

    const addImages = useCallback((files: File[]) => {
        setImages((prev) => {
            if (prev.length + files.length > MAX_IMAGES) {
                toast.error(`Up to ${MAX_IMAGES} images`);
                return prev;
            }
            return [...prev, ...files.map((f) => ({ id: `new-${crypto.randomUUID()}`, url: URL.createObjectURL(f), file: f }))];
        });
    }, []);
    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: addImages, accept: { "image/*": [] } });

    const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

    const save = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        try {
            const specsObject: Record<string, string> = {};
            for (const s of form.specs) if (s.key.trim()) specsObject[s.key.trim()] = s.value;
            // Saved among the specs, where checkout and the edit form read it back.
            if (form.allow_cod_override) specsObject[COD_KEY] = "true";

            // Media goes straight to Cloudinary; the API only receives URLs (Lambda payload limit).
            const uploaded = await Promise.all(images.filter((i) => i.file).map((i) => apiService.uploadProductMedia(i.file!, "image")));
            const videoUrl = video.file ? await apiService.uploadProductMedia(video.file, "video") : null;

            const payload: Record<string, unknown> = {
                name: form.name, description: form.description, short_description: form.short_description,
                price: form.price, stock: form.stock, category: form.category, sub_category: form.sub_category,
                specifications: JSON.stringify(specsObject), images: uploaded, videoUrl,
            };

            if (isNew) {
                await apiService.createProduct(payload);
                toast.success("Product created");
            } else {
                const kept = new Set(images.filter((i) => !i.file).map((i) => i.id));
                const removed = (product as AdminProduct).product_images?.filter((i) => !kept.has(i.id)).map((i) => i.id) ?? [];
                if (removed.length) payload.imagesToDelete = removed;
                await apiService.updateProduct((product as AdminProduct).id, payload);
                toast.success("Product saved");
            }
            onSaved();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not save the product");
        } finally {
            setSaving(false);
        }
    };

    const subs = SUB_CATEGORIES[form.category];

    return (
        <Sheet open={!!product} onOpenChange={(v) => !v && !saving && onClose()}>
            <SheetContent className="flex w-full flex-col p-0 sm:max-w-2xl">
                <SheetHeader className="border-b px-6 py-4 text-left">
                    <SheetTitle>{isNew ? "Add product" : "Edit product"}</SheetTitle>
                    <SheetDescription>{isNew ? "It goes live on the shop as soon as you save." : "Changes go live when you save."}</SheetDescription>
                </SheetHeader>

                <form id="product-form" onSubmit={save} className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
                    <Field label="Name"><Input value={form.name} onChange={(e) => set("name", e.target.value)} required /></Field>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Price (₹, GST included)"><Input type="number" min="0" step="0.01" value={form.price} onChange={(e) => set("price", e.target.value)} required /></Field>
                        <Field label="Stock"><Input type="number" min="0" value={form.stock} onChange={(e) => set("stock", e.target.value)} required /></Field>
                        <Field label="Category">
                            <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v, sub_category: "" }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>{MAIN_CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
                            </Select>
                        </Field>
                        <Field label="Sub-category">
                            <Select value={form.sub_category} onValueChange={(v) => set("sub_category", v)} disabled={!subs}>
                                <SelectTrigger><SelectValue placeholder={subs ? "Choose" : "None for this category"} /></SelectTrigger>
                                <SelectContent>{subs?.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                            </Select>
                        </Field>
                    </div>

                    <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
                        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={form.allow_cod_override} onChange={(e) => set("allow_cod_override", e.target.checked)} />
                        <span>
                            <span className="font-medium">Allow cash on delivery above ₹999</span>
                            <span className="block text-muted-foreground">Overrides the standard COD limit for this product.</span>
                        </span>
                    </label>

                    <Field label="Short description" hint={`${form.short_description.length}/150`}>
                        <Textarea value={form.short_description} maxLength={150} onChange={(e) => set("short_description", e.target.value)} rows={2} />
                    </Field>
                    <Field label="Full description"><Textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={7} /></Field>

                    <div>
                        <div className="mb-2 flex items-center justify-between">
                            <Label>Specifications</Label>
                            <Button type="button" variant="outline" size="sm" onClick={() => set("specs", [...form.specs, { key: "", value: "" }])}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
                        </div>
                        {form.specs.length === 0 && <p className="text-sm text-muted-foreground">e.g. Filament diameter: 1.75 mm</p>}
                        <div className="space-y-2">
                            {form.specs.map((s, i) => (
                                <div key={i} className="flex gap-2">
                                    <Input placeholder="Name" value={s.key} onChange={(e) => set("specs", form.specs.map((x, k) => (k === i ? { ...x, key: e.target.value } : x)))} />
                                    <Input placeholder="Value" value={s.value} onChange={(e) => set("specs", form.specs.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)))} />
                                    <Button type="button" variant="ghost" size="icon" onClick={() => set("specs", form.specs.filter((_, k) => k !== i))} title="Remove"><Trash2 className="h-4 w-4" /></Button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div>
                        <Label>Images <span className="font-normal text-muted-foreground">({images.length}/{MAX_IMAGES}, first is the cover)</span></Label>
                        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-5">
                            {images.map((img, i) => (
                                <div key={img.id} className="group relative aspect-square overflow-hidden rounded-md border bg-card">
                                    <img src={img.url} alt="" className="h-full w-full object-contain" />
                                    <button type="button" onClick={() => setImages((prev) => { release([prev[i]]); return prev.filter((_, k) => k !== i); })} className="absolute right-1 top-1 rounded-full bg-foreground/80 p-1 text-background opacity-0 transition-opacity group-hover:opacity-100" title="Remove"><X className="h-3 w-3" /></button>
                                </div>
                            ))}
                            {images.length < MAX_IMAGES && (
                                <div {...getRootProps()} className={`flex aspect-square cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed text-muted-foreground transition-colors hover:bg-muted/50 ${isDragActive ? "border-primary bg-primary/5" : ""}`}>
                                    <input {...getInputProps()} />
                                    <Upload className="h-5 w-5" />
                                    <span className="mt-1 text-[11px]">{isDragActive ? "Drop" : "Add"}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <Field label="Video">
                        <div className="flex flex-wrap items-center gap-3">
                            <Input type="file" accept="video/*" className="max-w-xs" onChange={(e) => { const f = e.target.files?.[0]; if (f) setVideo((v) => ({ ...v, file: f })); }} />
                            {!video.file && video.url && <a href={video.url} target="_blank" rel="noopener noreferrer" className="text-sm underline">Current video</a>}
                            {video.file && <span className="text-sm text-muted-foreground">{video.file.name}</span>}
                        </div>
                    </Field>
                </form>

                <SheetFooter className="border-t px-6 py-4">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" form="product-form" disabled={saving}>{saving ? "Saving…" : isNew ? "Create product" : "Save changes"}</Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}

const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
    <div className="space-y-1.5">
        <div className="flex justify-between"><Label>{label}</Label>{hint && <span className="text-xs text-muted-foreground">{hint}</span>}</div>
        {children}
    </div>
);
