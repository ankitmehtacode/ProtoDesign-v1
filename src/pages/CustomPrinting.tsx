import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STLViewer } from "@/components/STLViewer";
import { useDropzone } from "react-dropzone";
import { Upload, Check, RotateCw, Scale, Trash2, FileText, Info } from "lucide-react";
import { toast } from "sonner";
import { apiService } from "@/services/api.service";
import { formatINR } from "@/lib/currency";
import { DEFAULT_INFILL, INFILLS, MATERIALS, MAX_MODEL_MB, PRINTER_QUALITIES, colorHex, modelFileProblem, quotePrice, contactErrors, type ContactErrors } from "@/lib/quote";
import { QuoteContactCard, type QuoteContact } from "@/components/QuoteContactCard";
import { WhatsAppUpdatesButton } from "@/components/WhatsAppUpdatesButton";
import { Faq } from "@/components/Faq";
import { track } from "@/lib/analytics";

export default function CustomPrinting() {
    // --- STATE ---
    const [file, setFile] = useState<File | null>(null);

    // Rotation State (X, Y, Z degrees)
    const [rotation, setRotation] = useState({ x: 0, y: 0, z: 0 });

    const [modelStats, setModelStats] = useState({
        volume: 0,
        dimensions: { x: 0, y: 0, z: 0 },
        triangles: 0 // Added triangle count
    });

    const [scale, setScale] = useState(1); // 1 = 100%

    // Selections
    const [quality, setQuality] = useState(PRINTER_QUALITIES[0]);
    const [material, setMaterial] = useState(MATERIALS[0]);
    const [color, setColor] = useState(MATERIALS[0].colors[0]);
    const [infill, setInfill] = useState(DEFAULT_INFILL);

    const [contact, setContact] = useState<QuoteContact>({ email: "", phone: "", notes: "", website: "" });
    const [errors, setErrors] = useState<ContactErrors>({});
    const contactRef = useRef<HTMLFormElement>(null);
    // The mobile price bar shows while the contact card is off screen.
    const [contactInView, setContactInView] = useState(false);
    const [quoteId, setQuoteId] = useState<string | null>(null);
    // A guest cannot fetch a WhatsApp link later (it checks the account), so it
    // comes with the quote.
    const [whatsAppUrl, setWhatsAppUrl] = useState<string | undefined>();
    // Where the server sent the confirmation: the typed email or the account's.
    const [sentTo, setSentTo] = useState("");
    const [isSending, setIsSending] = useState(false);
    // null when idle; 0..1 while the model is uploading to storage.
    const [uploadProgress, setUploadProgress] = useState<number | null>(null);
    const [isSuccess, setIsSuccess] = useState(false)

    // Signed-in customers start with their saved details filled in.
    useEffect(() => {
        if (!apiService.isAuthenticated()) return;
        apiService.getUserProfile()
            .then((profile) => setContact(c => ({
                ...c,
                email: c.email || profile?.email || "",
                phone: c.phone || profile?.phone_number || "",
            })))
            .catch((err) => console.warn("Could not prefill quote contact", err));
    }, []);

    useEffect(() => {
        const el = contactRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(([entry]) => setContactInView(entry.isIntersecting), { threshold: 0.2 });
        observer.observe(el);
        return () => observer.disconnect();
    }, [isSuccess]);

    // --- ACTIONS ---

    const handleRemoveFile = () => {
        setFile(null);
        setRotation({ x: 0, y: 0, z: 0 });
        setScale(1);
        setModelStats({ volume: 0, dimensions: { x: 0, y: 0, z: 0 }, triangles: 0 });
        toast.info("Model removed");
    };

    const updateContact = (next: Partial<QuoteContact>) => {
        setContact(c => ({ ...c, ...next }));
        // An error clears as soon as the field it is about is edited.
        setErrors(e => ({ ...e, ...("email" in next ? { email: undefined } : {}), ...("phone" in next ? { phone: undefined } : {}) }));
    };

    /** Brings the contact card into view with the first field that needs attention focused. */
    const goToContact = (problems: ContactErrors = contactErrors(contact)) => {
        contactRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        const field = problems.email ? "quote-email" : problems.phone ? "quote-phone" : null;
        if (field) document.getElementById(field)?.focus({ preventScroll: true });
    };

    const handleSendQuote = async () => {
        if (!file) {
            toast.error("Please choose a model file first.");
            return;
        }
        // Nothing is uploaded without a way to reach the customer: a quote the
        // team cannot reply to is no use. The server enforces the same rule.
        const problems = contactErrors(contact);
        if (problems.email || problems.phone) {
            setErrors(problems);
            goToContact(problems);
            return;
        }
        setIsSending(true);

        const specs = JSON.stringify({
            quality: quality.name,
            material: `${material.name} - ${color}`,
            infill: `${infill}%`,
            originalStats: modelStats,
            polygonCount: modelStats.triangles,
            estimatedWeight: calculateWeight(),
            printDimensions: printDims,
            scale: `${(scale * 100).toFixed(0)}%`,
            rotation: `X:${rotation.x} Y:${rotation.y} Z:${rotation.z}`,
            estimatedPrice: calculatePrice(),
            estimatedTime: calculateTime()
        });
        try {
            // Two steps: the model goes straight to storage, then the quote is
            // recorded against the returned key. The API never carries the file,
            // so model size is not bounded by the request limit.
            setUploadProgress(0);
            track("quote_start");
            const { key: fileKey, guestToken } = await apiService.uploadModel(
                file,
                { email: contact.email, phone: contact.phone, website: contact.website },
                setUploadProgress,
            );

            const result = await apiService.sendQuoteRequest({
                fileKey,
                fileName: file.name,
                email: contact.email,
                phone: contact.phone,
                notes: contact.notes,
                specifications: specs,
                guestToken,
            });

            setQuoteId(result?.quoteId ?? null);
            setWhatsAppUrl(result?.whatsAppUrl);
            setSentTo(result?.email || contact.email.trim());
            toast.success("Quote sent successfully!");
            setIsSuccess(true);
        } catch (error) {
            console.error(error);
            // Surface the real reason -- size and file-type rejections are
            // actionable, and a generic message just makes people retry.
            toast.error(error instanceof Error && error.message ? error.message : "Failed to send quote. Please try again.");
        } finally {
            setIsSending(false);
            setUploadProgress(null);
        }
    };

    // --- LOGIC: DIMENSION SCALING ---


    const printDims = {
        x: parseFloat((modelStats.dimensions.x * scale).toFixed(2)),
        y: parseFloat((modelStats.dimensions.y * scale).toFixed(2)),
        z: parseFloat((modelStats.dimensions.z * scale).toFixed(2)),
    };

    const handleDimensionChange = (axis: 'x' | 'y' | 'z', value: string) => {
        const val = parseFloat(value);
        if (isNaN(val) || val <= 0) return;
        const originalDim = modelStats.dimensions[axis];
        if (originalDim > 0) {
            setScale(val / originalDim);
        }
    };

    // --- LOGIC: PRICING & WEIGHT ---

    // Weight = Volume (cm3) * Scale^3 * Density (g/cm3) * Infill Factor (approx)
    const calculateWeight = () => {
        if (!modelStats.volume) return "0 g";
        const scaledVolume = modelStats.volume * Math.pow(scale, 3);
        const infillFactor = 0.3 + (infill / 100 * 0.7); // Rough approximation: Shell is solid, infill varies
        const weight = scaledVolume * material.density * infillFactor;
        return `${weight.toFixed(1)} g`;
    };

    const calculatePrice = () => quotePrice(modelStats.volume * Math.pow(scale, 3), quality.multiplier, infill);

    const calculateTime = () => {
        if (!modelStats.volume) return "0h 0m";
        const scaledVolume = modelStats.volume * Math.pow(scale, 3);
        const hours = (scaledVolume / 10) * quality.multiplier * (1 + infill/100);
        const h = Math.floor(hours);
        const m = Math.floor((hours - h) * 60);
        return `${h}h ${m}m`;
    };

    const onDrop = useCallback((files: File[]) => {
        const [next] = files;
        if (!next) return;
        const problem = modelFileProblem(next);
        if (problem) {
            toast.error(problem);
            return;
        }
        setFile(next);
        setRotation({ x: 0, y: 0, z: 0 });
        setScale(1);
    }, []);
    const { getRootProps, getInputProps } = useDropzone({
        onDrop,
        onDropRejected: ([rejection]) => {
            if (rejection) toast.error(modelFileProblem(rejection.file) ?? "Choose one STL or OBJ file.");
        },
        accept: {'model/stl':['.stl'], 'model/obj':['.obj']},
        maxFiles: 1,
        maxSize: MAX_MODEL_MB * 1024 * 1024,
        disabled: !!file
    });

    if (isSuccess) {
        return (
            <div className="min-h-screen flex items-center justify-center pt-20">
                <div className="text-center max-w-md p-8">
                    <div className="w-20 h-20 bg-green-500/15 text-green-300 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Check className="w-10 h-10" />
                    </div>
                    <h2 className="text-3xl font-bold mb-4">Request Sent!</h2>
                    <p className="text-muted-foreground mb-8">
                        Our team will verify your file and send the payment link{sentTo && <> to <strong>{sentTo}</strong></>} shortly.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                        {quoteId && <WhatsAppUpdatesButton kind="quote" id={quoteId} href={whatsAppUrl} size="default" />}
                        <Button onClick={() => window.location.reload()}>Submit Another</Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className={`min-h-screen pt-24 bg-muted/30 ${file ? "pb-28 lg:pb-12" : "pb-12"}`}>
            <div className="container mx-auto px-4">

                <div className="mb-10 flex items-baseline gap-4 border-b border-border pb-6">
                    <h1 className="font-display text-4xl md:text-5xl font-bold leading-tight">
                        Instant 3D Printing Quote
                    </h1>
                    <span className="hidden md:block text-sm text-muted-foreground whitespace-nowrap">
                        Upload a model, dial in the specs, get a live price.
                    </span>
                </div>

                <div className="grid lg:grid-cols-12 gap-8 items-start">

                    {/* LEFT COLUMN: Viewer */}
                    <div className="lg:col-span-7 lg:sticky lg:top-24 space-y-4">
                        <Card className="overflow-hidden border-2 border-dashed border-border/50 shadow-sm">

                            {/* File Header Bar */}
                            {file && (
                                <div className="bg-card border-b p-3 flex justify-between items-center px-4">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        <div className="bg-blue-500/15 p-1.5 rounded text-blue-300">
                                            <FileText className="w-4 h-4" />
                                        </div>
                                        <div className="truncate">
                                            <p className="text-sm font-semibold truncate max-w-[200px]">{file.name}</p>
                                            <p className="text-xs text-muted-foreground">{(file.size/1024/1024).toFixed(2)} MB</p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={handleRemoveFile}
                                        className="h-8 px-3"
                                    >
                                        <Trash2 className="w-4 h-4 mr-1.5" /> Remove
                                    </Button>
                                </div>
                            )}

                            <div className="h-[500px] w-full bg-slate-900 relative">
                                <STLViewer
                                    file={file}
                                    scale={scale} // Pass dynamic scale
                                    rotation={rotation} // Pass dynamic rotation object
                                    color={colorHex(color)} // Pass dynamic color
                                    onStatsCalculated={setModelStats}
                                />
                                {!file && (
                                    <div {...getRootProps()} className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/20 cursor-pointer hover:bg-black/30 transition text-white">
                                        <input {...getInputProps()} />
                                        <div className="bg-white/10 p-4 rounded-full backdrop-blur-sm mb-4">
                                            <Upload className="w-8 h-8" />
                                        </div>
                                        <p className="font-semibold text-lg">Click or Drop STL/OBJ here</p>
                                        <p className="mt-1 text-sm text-white/70">See your price in seconds. Free, no sign-up.</p>
                                    </div>
                                )}
                            </div>
                        </Card>

                        {/* Rotation Inputs (Merged from custom.tsx) */}
                        {file && (
                            <div className="flex flex-col gap-3 p-4 bg-card rounded-lg border shadow-sm">
                                <div className="flex items-center gap-2 text-sm font-medium">
                                    <RotateCw className="w-4 h-4 text-muted-foreground" />
                                    Model Orientation (Degrees)
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs w-4">X</Label>
                                        <Input
                                            type="number"
                                            className="h-8"
                                            value={rotation.x}
                                            onChange={e => setRotation(p => ({...p, x: Number(e.target.value)}))}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs w-4">Y</Label>
                                        <Input
                                            type="number"
                                            className="h-8"
                                            value={rotation.y}
                                            onChange={e => setRotation(p => ({...p, y: Number(e.target.value)}))}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Label className="text-xs w-4">Z</Label>
                                        <Input
                                            type="number"
                                            className="h-8"
                                            value={rotation.z}
                                            onChange={e => setRotation(p => ({...p, z: Number(e.target.value)}))}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* RIGHT COLUMN: Configuration Form */}
                    <div className="lg:col-span-5 space-y-6">

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Info className="w-5 h-5 text-primary" /> Model Stats
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="grid grid-cols-2 gap-4 p-3 bg-muted/30 rounded-lg text-sm mb-2">
                                    <div>
                                        <span className="text-muted-foreground block text-xs mb-1">Original Size</span>
                                        <span className="font-mono font-medium">
                                            {modelStats.dimensions.x} x {modelStats.dimensions.y} x {modelStats.dimensions.z} cm
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block text-xs mb-1">Triangle Count</span>
                                        <span className="font-mono font-medium">
                                            {modelStats.triangles.toLocaleString()}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block text-xs mb-1">Material Volume</span>
                                        <span className="font-mono font-medium">
                                            {(modelStats.volume * Math.pow(scale, 3)).toFixed(2)} cm³
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-muted-foreground block text-xs mb-1">Est. Weight</span>
                                        <span className="font-mono font-medium">
                                            {calculateWeight()}
                                        </span>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <Label>Printing Dimensions (cm)</Label>
                                    <div className="grid grid-cols-3 gap-2">
                                        <div>
                                            <Input
                                                type="number"
                                                value={printDims.x}
                                                onChange={e => handleDimensionChange('x', e.target.value)}
                                                onFocus={e => e.target.select()}
                                                placeholder="L"
                                            />
                                            <span className="text-xs text-muted-foreground text-center block mt-1">Length</span>
                                        </div>
                                        <div>
                                            <Input
                                                type="number"
                                                value={printDims.y}
                                                onChange={e => handleDimensionChange('y', e.target.value)}
                                                onFocus={e => e.target.select()}
                                                placeholder="W"
                                            />
                                            <span className="text-xs text-muted-foreground text-center block mt-1">Width</span>
                                        </div>
                                        <div>
                                            <Input
                                                type="number"
                                                value={printDims.z}
                                                onChange={e => handleDimensionChange('z', e.target.value)}
                                                onFocus={e => e.target.select()}
                                                placeholder="H"
                                            />
                                            <span className="text-xs text-muted-foreground text-center block mt-1">Height</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <Label className="flex justify-between">
                                        <span>Scale Factor</span>
                                        <span className="text-muted-foreground font-normal">{(scale * 100).toFixed(0)}%</span>
                                    </Label>
                                    <div className="flex items-center gap-2">
                                        <Scale className="w-4 h-4 text-muted-foreground" />
                                        <Input
                                            type="number"
                                            step="1"
                                            min="10"
                                            value={parseFloat((scale * 100).toFixed(0))}
                                            onChange={e => {
                                                const val = parseFloat(e.target.value);
                                                if (val > 0) setScale(val / 100);
                                            }}
                                            onFocus={e => e.target.select()}
                                            className="w-24"
                                        />
                                        <span className="text-sm font-medium">%</span>
                                    </div>
                                    {/* Infinite Slider */}
                                    <input
                                        type="range"
                                        min="10"
                                        max="500" // Goes up to 500% now
                                        value={scale * 100}
                                        onChange={(e) => setScale(Number(e.target.value) / 100)}
                                        className="w-full accent-primary h-2 bg-muted rounded-lg appearance-none cursor-pointer mt-2"
                                    />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="pb-3">
                                <CardTitle className="text-lg">Printer Settings</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-3">
                                    <Label>Quality Level</Label>
                                    <select
                                        className="w-full h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                                        value={quality.id}
                                        onChange={e => setQuality(PRINTER_QUALITIES.find(q => q.id === e.target.value) || quality)}
                                    >
                                        {PRINTER_QUALITIES.map(q => (
                                            <option key={q.id} value={q.id}>{q.name}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Material</Label>
                                        <div className="flex flex-col gap-2">
                                            {MATERIALS.map(m => (
                                                <div
                                                    key={m.id}
                                                    onClick={() => { setMaterial(m); setColor(m.colors[0]); }}
                                                    className={`px-3 py-2 rounded border cursor-pointer text-sm font-medium transition-colors ${material.id === m.id ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-muted'}`}
                                                >
                                                    {m.name}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Color</Label>
                                        <div className="flex flex-col gap-2 h-40 overflow-y-auto pr-1">
                                            {material.colors.map(c => (
                                                <div
                                                    key={c}
                                                    onClick={() => setColor(c)}
                                                    className={`px-3 py-2 rounded border cursor-pointer text-sm transition-colors ${color === c ? 'bg-muted border-foreground' : 'hover:bg-muted/50'}`}
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <div
                                                            className={`w-3 h-3 rounded-full border shadow-sm`}
                                                            style={{ backgroundColor: colorHex(c) }}
                                                        />
                                                        {c}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <Label className="flex justify-between">
                                        <span>Infill Density</span>
                                        <span className="font-bold text-primary">{infill}%</span>
                                    </Label>
                                    <div className="flex flex-wrap gap-2">
                                        {INFILLS.map(i => (
                                            <Button
                                                key={i}
                                                variant={infill === i ? "default" : "outline"}
                                                onClick={() => setInfill(i)}
                                                size="sm"
                                                className="h-8 w-12 p-0"
                                            >
                                                {i}%
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <QuoteContactCard
                            ref={contactRef}
                            price={calculatePrice()}
                            printTime={calculateTime()}
                            summary={`${material.name} ${color} · ${infill}% infill · ${quality.name}`}
                            contact={contact}
                            onContactChange={updateContact}
                            errors={errors}
                            onSubmit={handleSendQuote}
                            sending={isSending}
                            uploadProgress={uploadProgress}
                            hasFile={!!file}
                        />

                    </div>
                </div>
                <Faq />
            </div>

            {/* Mobile: the price and the way to the contact card stay in reach
                while the visitor scrolls through the settings. */}
            {file && (
                <div
                    aria-hidden={contactInView}
                    className={`fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-background/95 px-4 py-3 backdrop-blur-md transition-transform duration-300 lg:hidden ${contactInView ? 'translate-y-full' : 'translate-y-0'}`}
                    style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
                >
                    <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                            <p className="text-xs text-muted-foreground">Your estimate</p>
                            <p className="font-display text-lg font-bold tabular-nums">{formatINR(calculatePrice())}</p>
                        </div>
                        <Button onClick={() => goToContact()} tabIndex={contactInView ? -1 : 0} className="h-11 shrink-0 rounded-full px-6 font-semibold active:scale-[0.98]">
                            Get my exact quote
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}