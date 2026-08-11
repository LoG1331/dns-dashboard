import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, ArrowRight, Loader2, Eye, EyeOff, X } from 'lucide-react';
import { Turnstile } from '@marsidev/react-turnstile';
import api from '../services/api';

const Auth = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(false);

    // Turnstile toggle - set to false in local development
    const enableTurnstile = import.meta.env.VITE_ENABLE_TURNSTILE === 'true';

    const [error, setError] = useState("");

    // Form State
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [turnstileToken, setTurnstileToken] = useState("");

    const handleLogin = async (e) => {
        e.preventDefault();
        if (enableTurnstile && !turnstileToken) {
            setError("Please complete the security check");
            return;
        }
        setLoading(true);
        setError("");
        try {
            const res = await api.post('/auth/login', { email, password });
            localStorage.setItem('token', res.data.token);
            navigate('/dashboard');
        } catch (err) {
            setError(err.response?.data?.error || "Login failed");
            setTurnstileToken(""); // Reset token on error
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#1A1A1A] flex flex-col justify-center items-center p-4 relative overflow-hidden bg-[url('/pixel_art_large.png')] bg-cover bg-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm"></div>

            <div className="relative z-10 mb-8 flex items-center gap-3">
                <img src="/logo.png" alt="Logo" className="h-10 w-auto brightness-0 invert" />
                <span className="text-2xl font-bold text-white tracking-tight">DNS Dashboard</span>
            </div>

            <div className="relative z-10 w-full max-w-md bg-[#262626]/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-8 transition-all duration-300">

                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-white mb-2">Welcome back</h2>
                    <p className="text-[#A3A3A3] text-sm">
                        Enter your credentials to access your dashboard
                    </p>
                </div>

                {/* Messages */}
                {error && (
                    <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center flex items-center justify-center gap-2">
                        <X className="w-4 h-4" /> {error}
                    </div>
                )}

                <form onSubmit={handleLogin} className="space-y-4">
                    <InputGroup label="Email" icon={Mail} type="email" value={email} onChange={setEmail} placeholder="admin@example.com" />
                    <InputGroup label="Password" icon={Lock} type="password" value={password} onChange={setPassword} placeholder="••••••••" />

                    {enableTurnstile && (
                        <div className="flex justify-center my-4">
                            <Turnstile
                                siteKey={import.meta.env.VITE_TURNSTILE_SITE_KEY}
                                onSuccess={setTurnstileToken}
                                options={{ theme: 'dark' }}
                            />
                        </div>
                    )}
                    <SubmitButton loading={loading} text="Sign In" />
                </form>
            </div>
        </div>
    );
};

const InputGroup = ({ label, icon: Icon, type, value, onChange, placeholder, error }) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';
    const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

    return (
        <div className="space-y-1.5">
            <label className="text-xs font-bold text-[#A3A3A3] uppercase tracking-wide ml-1">{label}</label>
            <div className="relative">
                <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#666]" />
                <input
                    type={inputType}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder={placeholder}
                    className={`w-full bg-[#1A1A1A] border rounded-xl py-2.5 pl-10 pr-10 focus:outline-none focus:ring-1 transition-all placeholder-[#444] text-white ${
                        error
                            ? 'border-red-500 focus:border-red-500 focus:ring-red-500'
                            : 'border-[#333] focus:border-[#38BDF8] focus:ring-[#38BDF8]'
                    }`}
                    required
                />
                {isPassword && (
                    <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#666] hover:text-white transition-colors"
                    >
                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                )}
            </div>
            {error && <p className="text-xs text-red-400 mt-1 ml-1">{error}</p>}
        </div>
    );
};

const SubmitButton = ({ loading, text }) => (
    <button
        type="submit"
        disabled={loading}
        className="w-full bg-[#38BDF8] hover:bg-[#0EA5E9] text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all shadow-[0_0_20px_rgba(56,189,248,0.2)] hover:shadow-[0_0_30px_rgba(56,189,248,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
    >
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
            <>
                {text} <ArrowRight className="w-5 h-5" />
            </>
        )}
    </button>
);

export default Auth;
