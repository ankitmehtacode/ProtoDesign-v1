import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiService } from '@/services/api.service';
import { toast } from 'sonner';
import { Loader2, Eye, EyeOff } from 'lucide-react';
import { GoogleLogin, CredentialResponse } from '@react-oauth/google';
import protodesignWordmark from '@/assets/protodesign-wordmark.webp';

export default function Auth() {
    const navigate = useNavigate();
    const [isLoading, setIsLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('login');

    // Visibility States
    const [showLoginPassword, setShowLoginPassword] = useState(false);
    const [showSignupPassword, setShowSignupPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    // Google renders its button in an iframe at a fixed pixel width (max 400)
    // and never resizes it, so measure the slot once and hand that over.
    const googleSlotRef = useRef<HTMLDivElement>(null);
    const [googleWidth, setGoogleWidth] = useState(0);
    useEffect(() => {
        const w = googleSlotRef.current?.clientWidth ?? 0;
        setGoogleWidth(Math.min(400, Math.floor(w)));
    }, []);

    const [loginData, setLoginData] = useState({ email: '', password: '' });
    const [signupData, setSignupData] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });

    // --- GOOGLE LOGIN HANDLER (NEW) ---
    const handleGoogleSuccess = async (credentialResponse: CredentialResponse) => {
        try {
            if (!credentialResponse.credential) {
                toast.error("Google login failed. No credential received.");
                return;
            }

            setIsLoading(true);
            // Send token to backend
            const response = await apiService.loginWithGoogle(credentialResponse.credential);

            // Save session
            navigate(response.user.role === 'admin' ? '/admin' : '/');

            // Notify & Redirect
            toast.success(`Welcome back, ${response.user.full_name}!`);

            // Check for redirect (e.g., from Cart)
            const redirectUrl = localStorage.getItem('redirectAfterLogin');
            if (redirectUrl) {
                localStorage.removeItem('redirectAfterLogin');
                navigate(redirectUrl);
            } else {
                navigate(response.user.role === 'admin' ? '/admin' : '/');
            }

        } catch (error: any) {
            console.error("Google Auth Error:", error);
            toast.error(error.message || "Google authentication failed");
        } finally {
            setIsLoading(false);
        }
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            const response = await apiService.login(loginData.email, loginData.password);
            navigate(response.user.role === 'admin' ? '/admin' : '/');
            toast.success('Logged in successfully');

            const redirectUrl = localStorage.getItem('redirectAfterLogin');
            if (redirectUrl) {
                localStorage.removeItem('redirectAfterLogin');
                navigate(redirectUrl);
            } else {
                navigate(response.user.role === 'admin' ? '/admin' : '/');
            }
        } catch (error: any) {
            toast.error(error.message || 'Login failed');
        } finally {
            setIsLoading(false);
        }
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (signupData.password !== signupData.confirmPassword) {
            toast.error("Passwords don't match");
            return;
        }
        setIsLoading(true);
        try {
            const response = await apiService.register(signupData.fullName, signupData.email, signupData.password);
            navigate(response.user.role === 'admin' ? '/admin' : '/');
            toast.success('Account created successfully');
            navigate('/');
        } catch (error: any) {
            toast.error(error.message || 'Registration failed');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        // pt-24 clears the fixed h-20 nav; the card is top-aligned on phones so the
        // form sits above the keyboard, and centred once there is room.
        <div className="flex flex-col items-center min-h-[100svh] px-4 pt-24 pb-8 sm:justify-center bg-gray-50">
            <Card className="w-full max-w-md shadow-lg">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                    <CardHeader className="p-5 sm:p-6">
                        {/* The nav already shows the wordmark, and on a phone a second copy at
                            h-36 pushed the form below the fold. Phones get a text heading; the
                            large wordmark returns from sm up, where there is room for both.
                            -mx-6 there cancels CardHeader's padding: the 448px card minus
                            padding leaves 400px, short of the 420px+ this 3:1 wordmark needs. */}
                        <CardTitle className="text-center text-2xl sm:hidden">Welcome</CardTitle>
                        <div className="hidden sm:flex justify-center -mx-6">
                            <img src={protodesignWordmark} alt="ProtoDesign" className="h-36 w-auto" />
                        </div>
                        <CardDescription className="text-center">
                            Login or create an account to manage your orders
                        </CardDescription>
                        <TabsList className="grid w-full grid-cols-2 mt-4">
                            <TabsTrigger value="login">Login</TabsTrigger>
                            <TabsTrigger value="signup">Sign Up</TabsTrigger>
                        </TabsList>
                    </CardHeader>

                    <CardContent className="space-y-4 px-5 sm:px-6">
                        <TabsContent value="login">
                            <form onSubmit={handleLogin} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="email">Email</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        autoComplete="email"
                                        inputMode="email"
                                        placeholder="m@example.com"
                                        required
                                        value={loginData.email}
                                        onChange={(e) => setLoginData({...loginData, email: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <Label htmlFor="password">Password</Label>
                                        <Link to="/forgot-password" className="text-sm text-primary hover:underline">
                                            Forgot password?
                                        </Link>
                                    </div>
                                    <div className="relative">
                                        <Input
                                            className="pr-11"
                                            id="password"
                                            type={showLoginPassword ? "text" : "password"}
                                            autoComplete="current-password"
                                            required
                                            value={loginData.password}
                                            onChange={(e) => setLoginData({...loginData, password: e.target.value})}
                                        />
                                        <button type="button" onClick={() => setShowLoginPassword(!showLoginPassword)} aria-label={showLoginPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500">
                                            {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Login'}
                                </Button>
                            </form>
                        </TabsContent>

                        <TabsContent value="signup">
                            <form onSubmit={handleSignup} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="fullName">Full Name</Label>
                                    <Input
                                        id="fullName"
                                        autoComplete="name"
                                        required
                                        value={signupData.fullName}
                                        onChange={(e) => setSignupData({...signupData, fullName: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="signup-email">Email</Label>
                                    <Input
                                        id="signup-email"
                                        type="email"
                                        autoComplete="email"
                                        inputMode="email"
                                        required
                                        value={signupData.email}
                                        onChange={(e) => setSignupData({...signupData, email: e.target.value})}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="signup-password">Password</Label>
                                    <div className="relative">
                                        <Input
                                            className="pr-11"
                                            id="signup-password"
                                            type={showSignupPassword ? "text" : "password"}
                                            autoComplete="new-password"
                                            required
                                            value={signupData.password}
                                            onChange={(e) => setSignupData({...signupData, password: e.target.value})}
                                        />
                                        <button type="button" onClick={() => setShowSignupPassword(!showSignupPassword)} aria-label={showSignupPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500">
                                            {showSignupPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="confirm-password">Confirm Password</Label>
                                    <div className="relative">
                                        <Input
                                            className="pr-11"
                                            id="confirm-password"
                                            type={showConfirmPassword ? "text" : "password"}
                                            autoComplete="new-password"
                                            required
                                            value={signupData.confirmPassword}
                                            onChange={(e) => setSignupData({...signupData, confirmPassword: e.target.value})}
                                        />
                                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} aria-label={showConfirmPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-gray-500">
                                            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                </div>
                                <Button type="submit" className="w-full" disabled={isLoading}>
                                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : 'Create Account'}
                                </Button>
                            </form>
                        </TabsContent>
                    </CardContent>
                </Tabs>

                {/* --- GOOGLE LOGIN BUTTON --- */}
                <div className="px-5 pb-5 sm:px-6 sm:pb-6">
                    <div className="relative my-4">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-muted-foreground">Or continue with</span></div>
                    </div>

                    <div ref={googleSlotRef} className="flex justify-center min-h-[44px]">
                        {googleWidth > 0 && <GoogleLogin
                            onSuccess={handleGoogleSuccess}
                            onError={() => toast.error('Google login failed')}
                            useOneTap={false}
                            theme="outline"
                            size="large"
                            width={String(googleWidth)}
                        />}
                    </div>
                </div>
            </Card>
        </div>
    );
};
