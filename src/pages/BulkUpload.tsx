import { useState } from "react";
import { apiService } from "@/services/api.service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, Download, Upload, FileSpreadsheet, CheckCircle2, Info } from "lucide-react";
import { toast } from "sonner";

export default function BulkUpload() {
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [lastResult, setLastResult] = useState<any>(null);

    const handleUpload = async () => {
        if (!file) return toast.error("Please select a CSV file");

        setLoading(true);
        setLastResult(null);

        try {
            const res = await apiService.bulkUploadProducts(file);
            setLastResult(res.results);
            if(res.results.success > 0) {
                toast.success(`Successfully uploaded ${res.results.success} products`);
                setFile(null);
            } else if (res.results.failed > 0) {
                toast.warning(`Some items failed. Uploaded: ${res.results.success}, Failed: ${res.results.failed}`);
            }
        } catch (error: any) {
            toast.error(error.message || "Upload failed. Check console/network.");
        } finally {
            setLoading(false);
        }
    };

    // ✅ UPDATED TEMPLATE: Includes 'images' column and examples
    const downloadTemplate = () => {
        const csvContent =
            `name,price,stock,category,sub_category,short_description,description,specifications,images
Standard PLA,1200,50,filament,PLA,Everyday filament,"High quality PLA.\\n\\nFeatures:\\n- Strong\\n- Easy to print",Material : PLA; Color : Red; Weight : 1kg,"https://drive.google.com/file/d/123/view
https://imgur.com/image.jpg"
Ender 3 V3,18000,10,3d_printer,FDM,Starter Printer,Reliable FDM printer.,Build Volume : 220x220; Nozzle : 0.4mm,`;

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "protodesign_bulk_template.csv";
        a.click();
    };

    return (
        <div className="container mx-auto px-4 pt-24 pb-12 min-h-screen max-w-3xl">
            <div className="mb-8">
                <h1 className="text-3xl font-bold mb-2">Bulk Product Upload</h1>
                <p className="text-muted-foreground">Quickly add products via CSV with text and image links.</p>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex justify-between items-center">
                        <CardTitle className="text-lg">1. Download Template</CardTitle>
                        <Button variant="outline" size="sm" onClick={downloadTemplate}>
                            <Download className="w-4 h-4 mr-2" /> Download CSV
                        </Button>
                    </div>
                    <CardDescription>
                        Contains headers and examples for all supported fields.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">

                    {/* ✅ UPDATED: Comprehensive Formatting Guide */}
                    <div className="bg-blue-500/15 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-500/30 dark:border-blue-900 text-sm space-y-4">
                        <div className="flex items-center gap-2 font-semibold text-blue-300 dark:text-blue-400">
                            <Info size={16} /> CSV Formatting Guide
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Left Column: Essential */}
                            <div>
                                <h4 className="font-bold text-blue-300 dark:text-blue-300 mb-2">Required Columns</h4>
                                <ul className="list-disc pl-4 text-muted-foreground space-y-1">
                                    <li><b>name:</b> Product title.</li>
                                    <li><b>price:</b> Numbers only (e.g. <code>1200</code>). Symbols removed automatically.</li>
                                    <li><b>stock:</b> Quantity available (e.g. <code>50</code>).</li>
                                </ul>
                            </div>

                            {/* Right Column: Special Formats */}
                            <div>
                                <h4 className="font-bold text-blue-300 dark:text-blue-300 mb-2">Special Formats</h4>
                                <ul className="list-disc pl-4 text-muted-foreground space-y-1">
                                    <li><b>New Lines:</b> Type <code>\n</code> in description for line breaks.</li>
                                    <li><b>Specs:</b> Format as <code>Key : Value;</code> (Use semicolon to separate).</li>
                                    <li><b>Images:</b> Paste Links (Drive/Imgur) separated by space or new line.</li>
                                </ul>
                            </div>
                        </div>

                        <div className="pt-3 border-t border-blue-500/30 dark:border-blue-800">
                            <h4 className="font-bold text-blue-300 dark:text-blue-300 mb-2">Optional Columns Reference</h4>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-xs text-muted-foreground">
                                <p><code className="font-semibold text-blue-300">category</code>: Main ID (e.g. <i>3d_printer, filament</i>).</p>
                                <p><code className="font-semibold text-blue-300">sub_category</code>: Filter tag (e.g. <i>PLA, FDM</i>).</p>
                                <p><code className="font-semibold text-blue-300">short_description</code>: 1-2 sentence summary.</p>
                                <p><code className="font-semibold text-blue-300">description</code>: Full details. Supports <code>\n</code>.</p>
                            </div>
                        </div>
                    </div>

                    <div className="border-t pt-6">
                        <h3 className="text-lg font-medium mb-4">2. Upload CSV</h3>
                        <div className="grid w-full max-w-sm items-center gap-1.5 mb-4">
                            <Label htmlFor="csv-upload">Select File</Label>
                            <Input
                                id="csv-upload"
                                type="file"
                                accept=".csv"
                                onChange={(e) => setFile(e.target.files?.[0] || null)}
                            />
                        </div>

                        {file && (
                            <div className="bg-muted/30 p-3 rounded-lg flex items-center gap-3 border mb-4">
                                <FileSpreadsheet className="w-6 h-6 text-green-300" />
                                <div>
                                    <p className="font-medium text-sm">{file.name}</p>
                                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB</p>
                                </div>
                            </div>
                        )}

                        <Button onClick={handleUpload} disabled={loading || !file} className="w-full">
                            {loading ? "Processing..." : <><Upload className="w-4 h-4 mr-2" /> Upload Products</>}
                        </Button>
                    </div>

                    {lastResult && (
                        <div className="mt-6 space-y-4 animate-in fade-in slide-in-from-top-2 border-t pt-6">
                            <h3 className="font-medium">Upload Results</h3>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-4 bg-green-500/15 border border-green-500/30 rounded-lg text-center">
                                    <div className="flex justify-center mb-2"><CheckCircle2 className="text-green-300 w-6 h-6" /></div>
                                    <p className="text-2xl font-bold text-green-300">{lastResult.success}</p>
                                    <p className="text-xs font-medium text-green-300 uppercase">Successful</p>
                                </div>
                                <div className="p-4 bg-red-500/15 border border-red-500/30 rounded-lg text-center">
                                    <div className="flex justify-center mb-2"><AlertCircle className="text-red-300 w-6 h-6" /></div>
                                    <p className="text-2xl font-bold text-red-300">{lastResult.failed}</p>
                                    <p className="text-xs font-medium text-red-300 uppercase">Failed</p>
                                </div>
                            </div>

                            {lastResult.errors.length > 0 && (
                                <div className="bg-destructive/10 p-4 rounded-lg border border-destructive/20 max-h-40 overflow-y-auto">
                                    <h4 className="font-semibold text-sm mb-2 text-destructive">Error Log</h4>
                                    <ul className="text-xs space-y-1 text-muted-foreground list-disc pl-4">
                                        {lastResult.errors.map((err: string, i: number) => (
                                            <li key={i}>{err}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}