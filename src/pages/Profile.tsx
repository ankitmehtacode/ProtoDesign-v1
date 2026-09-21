import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { User, MapPin, Shield, FileText, Plus, Trash2, Edit2, LogOut, Loader2, Save, Send, Download, Box, Clock } from "lucide-react";
import { apiService } from "@/services/api.service";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { formatINR } from '@/lib/currency';

export default function Profile() {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [user, setUser] = useState<any>(null);
    const [addresses, setAddresses] = useState<any[]>([]);
    const [quotes, setQuotes] = useState<any[]>([]);

    // Profile Edit
    const [isEditing, setIsEditing] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [formData, setFormData] = useState({ fullName: "", phoneNumber: "", email: "" });

    // Address Edit
    const [isAddrDialogOpen, setIsAddrDialogOpen] = useState(false);
    const [editingAddrId, setEditingAddrId] = useState<string | null>(null);
    const [addrForm, setAddrForm] = useState({ label: "Home", fullName: "", phone: "", email: "", addressLine1: "", city: "", state: "", pincode: "", isDefault: false });

    // Security
    const [passData, setPassData] = useState({ oldPassword: "", newPassword: "", confirmPassword: "" });

    // Quote Detail
    const [selectedQuote, setSelectedQuote] = useState<any>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            const [profile, addrList, quoteList] = await Promise.all([
                apiService.getUserProfile(),
                apiService.getAddresses(),
                apiService.getMyQuotes().catch(() => [])
            ]);

            setUser(profile);

            setFormData({
                fullName: profile.full_name || profile.fullName || "",
                phoneNumber: profile.phone_number || profile.phoneNumber || "",
                email: profile.email || ""
            });

            setAddresses(addrList);
            setQuotes(quoteList);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    // --- Profile Handlers ---
    const handleUpdateProfile = async () => {
        setIsSavingProfile(true);
        try {
            await apiService.updateUserProfile({
                fullName: formData.fullName,
                phoneNumber: formData.phoneNumber
            });
            toast.success("Profile updated!");
            setIsEditing(false);
            loadData(); // Reload to confirm changes
        } catch (error) {
            toast.error("Failed to update profile");
        } finally {
            setIsSavingProfile(false);
        }
    };

    // --- Address Handlers ---
    const openAddAddress = () => {
        setEditingAddrId(null);
        setAddrForm({
            label: "Home",
            fullName: user?.full_name || user?.fullName || "",
            phone: user?.phone_number || user?.phoneNumber || "",
            email: "",
            addressLine1: "", city: "", state: "", pincode: "", isDefault: false
        });
        setIsAddrDialogOpen(true);
    };

    const openEditAddress = (addr: any) => {
        setEditingAddrId(addr.id);
        setAddrForm({
            label: addr.label || "Home",
            fullName: addr.full_name || addr.fullName || "",
            phone: addr.phone || "",
            email: addr.email || "",
            addressLine1: addr.address_line1 || addr.addressLine1 || "",
            city: addr.city || "",
            state: addr.state || "",
            pincode: addr.pincode || "",
            isDefault: !!(addr.is_default || addr.isDefault)
        });
        setIsAddrDialogOpen(true);
    };

    const handleSaveAddress = async () => {
        if(!addrForm.fullName || !addrForm.addressLine1 || !addrForm.city) {
            return toast.error("Please fill all required fields");
        }
        try {
            if (editingAddrId) {
                await apiService.updateAddress(editingAddrId, addrForm);
                toast.success("Address updated");
            } else {
                await apiService.addAddress(addrForm);
                toast.success("Address added");
            }
            setIsAddrDialogOpen(false);
            loadData();
        } catch (error: any) {
            toast.error(error.message || "Failed to save address");
        }
    };

    const handleDeleteAddress = async (id: string) => {
        if(!confirm("Delete this address?")) return;
        try {
            await apiService.deleteAddress(id);
            toast.success("Address deleted");
            loadData();
        } catch (error) {
            toast.error("Failed to delete");
        }
    };

    // --- Security Handlers ---
    const handleChangePassword = async () => {
        if (passData.newPassword !== passData.confirmPassword) {
            toast.error("New passwords do not match");
            return;
        }
        try {
            await apiService.changePassword(passData.oldPassword, passData.newPassword);
            toast.success("Password changed successfully");
            setPassData({ oldPassword: "", newPassword: "", confirmPassword: "" });
        } catch (error: any) {
            toast.error(error.message || "Failed to change password");
        }
    };

    const handleForgotPassword = async () => {
        try {
            await apiService.forgotPassword(user.email);
            toast.success("Reset link sent to email");
        } catch (error) {
            toast.error("Failed to send link");
        }
    };

    if (loading) return <div className="h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;

    return (
        <div className="container mx-auto px-4 pt-24 pb-12">
            <div className="flex flex-col md:flex-row gap-8">

                {/* Sidebar */}
                <Card className="w-full md:w-80 h-fit border-border/60">
                    <CardHeader className="text-center">
                        <div className="mx-auto w-24 h-24 relative mb-4">
                            <Avatar className="w-24 h-24">
                                <AvatarImage src={user?.avatar_url || user?.avatarUrl} />
                                <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                                    {user?.full_name?.charAt(0) || user?.fullName?.charAt(0) || "U"}
                                </AvatarFallback>
                            </Avatar>
                        </div>
                        <CardTitle>{user?.full_name || user?.fullName || "User"}</CardTitle>
                        <CardDescription>{user?.email}</CardDescription>
                    </CardHeader>
                    {user?.role === 'admin' && (
                        <CardContent className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground p-2 rounded bg-secondary/50">
                                <Shield className="w-4 h-4" />
                                Role: <span className="capitalize text-foreground font-medium">{user.role}</span>
                            </div>
                        </CardContent>
                    )}
                    <CardFooter>
                        <Button variant="destructive" className="w-full" onClick={() => { apiService.logout(); navigate('/'); }}>
                            <LogOut className="w-4 h-4 mr-2" /> Sign Out
                        </Button>
                    </CardFooter>
                </Card>

                {/* Main Content */}
                <div className="flex-1">
                    <Tabs defaultValue="general" className="w-full">
                        <TabsList className="grid w-full grid-cols-4 mb-8">
                            <TabsTrigger value="general"><User className="w-4 h-4 mr-2 hidden sm:block"/> General</TabsTrigger>
                            <TabsTrigger value="addresses"><MapPin className="w-4 h-4 mr-2 hidden sm:block"/> Addresses</TabsTrigger>
                            <TabsTrigger value="quotes"><FileText className="w-4 h-4 mr-2 hidden sm:block"/> My Quotes</TabsTrigger>
                            <TabsTrigger value="security"><Shield className="w-4 h-4 mr-2 hidden sm:block"/> Security</TabsTrigger>
                        </TabsList>

                        {/* 1. GENERAL */}
                        <TabsContent value="general">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Personal Information</CardTitle>
                                    <CardDescription>Update your contact details.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid gap-2">
                                        <Label>Full Name</Label>
                                        <Input
                                            value={formData.fullName}
                                            onChange={e => setFormData({...formData, fullName: e.target.value})}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Phone Number</Label>
                                        <Input
                                            value={formData.phoneNumber}
                                            onChange={e => setFormData({...formData, phoneNumber: e.target.value})}
                                            disabled={!isEditing}
                                        />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Email</Label>
                                        <Input value={formData.email} disabled className="bg-muted" />
                                    </div>
                                </CardContent>
                                <CardFooter className="flex justify-end gap-2">
                                    {isEditing ? (
                                        <>
                                            <Button variant="outline" onClick={() => setIsEditing(false)} disabled={isSavingProfile}>Cancel</Button>
                                            <Button onClick={handleUpdateProfile} disabled={isSavingProfile}>
                                                {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin mr-2"/> : <Save className="w-4 h-4 mr-2" />}
                                                Save
                                            </Button>
                                        </>
                                    ) : (
                                        <Button onClick={() => setIsEditing(true)}>Edit Details</Button>
                                    )}
                                </CardFooter>
                            </Card>
                        </TabsContent>

                        {/* 2. ADDRESSES */}
                        <TabsContent value="addresses">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold">Saved Addresses</h3>
                                <Dialog open={isAddrDialogOpen} onOpenChange={setIsAddrDialogOpen}>
                                    <Button size="sm" onClick={openAddAddress}><Plus className="w-4 h-4 mr-2" /> Add New</Button>
                                    <DialogContent>
                                        <DialogHeader>
                                            <DialogTitle>{editingAddrId ? 'Edit Address' : 'Add New Address'}</DialogTitle>
                                            <DialogDescription>Manage your delivery details.</DialogDescription>
                                        </DialogHeader>
                                        <div className="grid gap-4 py-4">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div><Label>Label</Label><Input value={addrForm.label || ''} onChange={e => setAddrForm({...addrForm, label: e.target.value})} placeholder="Home" /></div>
                                                <div><Label>Full Name</Label><Input value={addrForm.fullName || ''} onChange={e => setAddrForm({...addrForm, fullName: e.target.value})} /></div>
                                            </div>
                                            <div><Label>Address Line 1</Label><Input value={addrForm.addressLine1 || ''} onChange={e => setAddrForm({...addrForm, addressLine1: e.target.value})} /></div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div><Label>City</Label><Input value={addrForm.city || ''} onChange={e => setAddrForm({...addrForm, city: e.target.value})} /></div>
                                                <div><Label>State</Label><Input value={addrForm.state || ''} onChange={e => setAddrForm({...addrForm, state: e.target.value})} /></div>
                                            </div>
                                            <div className="grid grid-cols-2 gap-4">
                                                <div><Label>Pincode</Label><Input value={addrForm.pincode || ''} onChange={e => setAddrForm({...addrForm, pincode: e.target.value})} /></div>
                                                <div><Label>Phone</Label><Input value={addrForm.phone || ''} onChange={e => setAddrForm({...addrForm, phone: e.target.value})} /></div>
                                            </div>
                                            <div>
                                                <Label>Email</Label>
                                                <Input value={addrForm.email || ''} onChange={e => setAddrForm({...addrForm, email: e.target.value})} placeholder="Optional" />
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input type="checkbox" checked={!!addrForm.isDefault} onChange={e => setAddrForm({...addrForm, isDefault: e.target.checked})} id="def" className="w-4 h-4 accent-primary" />
                                                <Label htmlFor="def">Set as default</Label>
                                            </div>
                                            <Button onClick={handleSaveAddress} className="w-full mt-2">Save Address</Button>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            </div>

                            <div className="grid md:grid-cols-2 gap-4">
                                {addresses.map(addr => (
                                    <div key={addr.id} className="border rounded-xl p-4 relative group hover:border-primary/50 transition-colors">
                                        <div className="flex justify-between items-start mb-2">
                                            <div className="flex items-center gap-2">
                                                <Badge variant="outline">{addr.label}</Badge>
                                                {(addr.is_default || addr.isDefault) && <Badge className="bg-green-100 text-green-800 hover:bg-green-100">Default</Badge>}
                                            </div>
                                            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditAddress(addr)}><Edit2 className="w-3.5 h-3.5" /></Button>
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteAddress(addr.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                                            </div>
                                        </div>
                                        <p className="font-semibold">{addr.full_name || addr.fullName}</p>
                                        <p className="text-sm text-muted-foreground">{addr.address_line1 || addr.addressLine1}</p>
                                        <p className="text-sm text-muted-foreground">{addr.city}, {addr.state} - {addr.pincode}</p>
                                        <div className="mt-2 text-sm text-foreground/80 space-y-1">
                                            <p><span className="text-xs text-muted-foreground">Phone:</span> {addr.phone}</p>
                                            {addr.email && <p><span className="text-xs text-muted-foreground">Email:</span> {addr.email}</p>}
                                        </div>
                                    </div>
                                ))}
                                {addresses.length === 0 && <p className="text-muted-foreground col-span-2 text-center py-8">No saved addresses found.</p>}
                            </div>
                        </TabsContent>

                        {/* 3. MY QUOTES */}
                        <TabsContent value="quotes">
                            <Card>
                                <CardHeader>
                                    <CardTitle>My Quote Requests</CardTitle>
                                    <CardDescription>Custom 3D printing requests linked to your account.</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {quotes.length === 0 ? (
                                        <div className="text-center py-8 text-muted-foreground">
                                            <FileText className="w-12 h-12 mx-auto mb-2 opacity-20" />
                                            <p>No quotes found.</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {quotes.map(quote => {
                                                const specs = typeof quote.specifications === 'string'
                                                    ? JSON.parse(quote.specifications)
                                                    : quote.specifications || {};
                                                const price = quote.estimated_price || quote.estimatedPrice || 0;
                                                const fname = quote.file_name || quote.fileName || "Unknown File";

                                                return (
                                                    <div
                                                        key={quote.id}
                                                        className="border rounded-lg p-4 flex justify-between items-center hover:bg-accent/50 cursor-pointer"
                                                        onClick={() => setSelectedQuote({...quote, specifications: specs})}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(e) => {
                                                            // A real <button> can't nest the "View Specs" Button below
                                                            // (invalid HTML), so this row is made keyboard-accessible
                                                            // directly instead -- it was mouse-only before.
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                setSelectedQuote({...quote, specifications: specs});
                                                            }
                                                        }}
                                                    >
                                                        <div>
                                                            <h4 className="font-medium">{fname}</h4>
                                                            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                                                                <span className="flex items-center gap-1"><Clock size={12}/> {new Date(quote.created_at || quote.createdAt).toLocaleDateString()}</span>
                                                                <Badge variant={quote.status === 'pending' ? 'outline' : 'default'} className="text-xs capitalize">{quote.status}</Badge>
                                                            </div>
                                                        </div>
                                                        <div className="text-right">
                                                            <div className="font-bold text-primary">{formatINR(price)}</div>
                                                            <Button variant="ghost" size="sm" className="h-8 text-xs mt-1">View Specs</Button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            {/* Quote Dialog */}
                            <Dialog open={!!selectedQuote} onOpenChange={(o) => !o && setSelectedQuote(null)}>
                                <DialogContent className="max-w-3xl overflow-y-auto max-h-[90vh]">
                                    <DialogHeader>
                                        <DialogTitle>Quote Details</DialogTitle>
                                        <DialogDescription>Reference ID: {selectedQuote?.id}</DialogDescription>
                                    </DialogHeader>
                                    {selectedQuote && (
                                        <div className="space-y-6">
                                            {/* Header */}
                                            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-muted/30 p-4 rounded-lg border">
                                                <div>
                                                    <h3 className="text-xl font-bold flex items-center gap-2">
                                                        <Box className="w-5 h-5 text-primary"/>
                                                        {selectedQuote.file_name || selectedQuote.fileName}
                                                    </h3>
                                                    <div className="flex gap-2 mt-2">
                                                        <Badge className="capitalize">{selectedQuote.status}</Badge>
                                                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                                                            <Clock size={12}/> {new Date(selectedQuote.created_at || selectedQuote.createdAt).toLocaleString()}
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-right">
                                                    <p className="text-sm text-muted-foreground">Estimated Total</p>
                                                    <p className="text-2xl font-bold text-primary">{formatINR(selectedQuote.estimated_price || selectedQuote.estimatedPrice)}</p>
                                                </div>
                                            </div>

                                            {/* Specs */}
                                            <div className="grid md:grid-cols-2 gap-6">
                                                <Card>
                                                    <CardHeader className="pb-3"><CardTitle className="text-sm uppercase text-muted-foreground">Print Settings</CardTitle></CardHeader>
                                                    <CardContent className="grid grid-cols-2 gap-4 text-sm">
                                                        <div><span className="block text-xs text-muted-foreground">Material</span><span className="font-medium">{selectedQuote.specifications?.material}</span></div>
                                                        <div><span className="block text-xs text-muted-foreground">Quality</span><span className="font-medium">{selectedQuote.specifications?.quality}</span></div>
                                                        <div><span className="block text-xs text-muted-foreground">Infill</span><span className="font-medium">{selectedQuote.specifications?.infill}</span></div>
                                                        <div><span className="block text-xs text-muted-foreground">Color</span><span className="font-medium">{selectedQuote.specifications?.color || 'Standard'}</span></div>
                                                    </CardContent>
                                                </Card>

                                                <Card>
                                                    <CardHeader className="pb-3"><CardTitle className="text-sm uppercase text-muted-foreground">Model Analysis</CardTitle></CardHeader>
                                                    <CardContent className="space-y-3 text-sm">
                                                        <div className="flex justify-between border-b pb-2">
                                                            <span className="text-muted-foreground">Volume</span>
                                                            <span className="font-medium">{selectedQuote.specifications?.originalStats?.volume?.toFixed(2)} cm³</span>
                                                        </div>
                                                        <div className="flex justify-between border-b pb-2">
                                                            <span className="text-muted-foreground">Dimensions</span>
                                                            <span className="font-medium">
                                                                {selectedQuote.specifications?.printDimensions?.x} x {selectedQuote.specifications?.printDimensions?.y} x {selectedQuote.specifications?.printDimensions?.z} cm
                                                            </span>
                                                        </div>
                                                        <div className="flex justify-between">
                                                            <span className="text-muted-foreground">Est. Time</span>
                                                            <span className="font-medium">{selectedQuote.specifications?.estimatedTime}</span>
                                                        </div>
                                                    </CardContent>
                                                </Card>
                                            </div>

                                            {/* Admin Notes */}
                                            {selectedQuote.admin_notes && (
                                                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 p-4 rounded-lg">
                                                    <h4 className="font-semibold text-blue-700 dark:text-blue-300 mb-2 flex items-center gap-2">
                                                        <Shield className="w-4 h-4"/> Admin Response
                                                    </h4>
                                                    <p className="text-sm text-blue-900 dark:text-blue-100">{selectedQuote.admin_notes}</p>
                                                </div>
                                            )}

                                            {/* Action Buttons */}
                                            <div className="flex justify-end gap-3 pt-2">
                                                <Button variant="outline" asChild>
                                                    <button type="button" onClick={async () => {
                                                        try {
                                                            const url = await apiService.getQuoteDownloadUrl(selectedQuote.id);
                                                            window.open(url, "_blank", "noopener,noreferrer");
                                                        } catch (err: any) {
                                                            toast.error(err?.message || "Could not open that file.");
                                                        }
                                                    }}>
                                                        <Download className="w-4 h-4 mr-2" /> Download STL
                                                    </button>
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </DialogContent>
                            </Dialog>
                        </TabsContent>

                        {/* 4. SECURITY */}
                        <TabsContent value="security">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Security Settings</CardTitle>
                                    <CardDescription>Manage your password.</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-6 max-w-md">
                                    <div className="space-y-4">
                                        <h3 className="font-semibold text-sm">Change Password</h3>
                                        <div className="grid gap-2">
                                            <Label>Current Password</Label>
                                            <Input type="password" value={passData.oldPassword} onChange={e => setPassData({...passData, oldPassword: e.target.value})} />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>New Password</Label>
                                            <Input type="password" value={passData.newPassword} onChange={e => setPassData({...passData, newPassword: e.target.value})} />
                                        </div>
                                        <div className="grid gap-2">
                                            <Label>Confirm New Password</Label>
                                            <Input type="password" value={passData.confirmPassword} onChange={e => setPassData({...passData, confirmPassword: e.target.value})} />
                                        </div>
                                        <Button onClick={handleChangePassword}>Update Password</Button>
                                    </div>
                                    <div className="pt-4 border-t">
                                        <Button variant="outline" onClick={handleForgotPassword} className="w-full">
                                            <Send className="w-4 h-4 mr-2" /> Send Reset Link
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>
                </div>
            </div>
        </div>
    );
}