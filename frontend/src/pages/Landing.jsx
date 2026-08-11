import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, LayoutDashboard } from 'lucide-react';

const Landing = () => {
    const navigate = useNavigate();
    const [domain, setDomain] = useState("");
    const [isChecking, setIsChecking] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    // Mock check for now, or redirect to dashboard
    const handleCheck = () => {
        if (!domain) return;
        setIsChecking(true);
        setTimeout(() => {
            setIsChecking(false);
            navigate('/dashboard');
        }, 1000);
    };

    const isLoggedIn = !!localStorage.getItem('token');

    return (
        <div className="min-h-screen bg-[#1A1A1A] font-sans text-white selection:bg-[#38BDF8] selection:text-white">
            {/* Header */}
            <header className="fixed top-0 left-0 right-0 z-50 bg-[#1A1A1A]/95 backdrop-blur-md border-b border-white/5 w-full transition-all duration-300">
                <div className="w-full px-4 sm:px-6 md:px-12 lg:px-16 h-16 sm:h-20 flex items-center justify-between">
                    {/* Left Side: Logo */}
                    <div className="flex items-center gap-12">
                        <a href="/" className="flex items-center gap-3 transition-transform hover:scale-105 active:scale-95">
                            <img src="/logo_white.png" alt="Logo" className="h-8 sm:h-10 w-auto" />
                            <span className="text-sm sm:text-lg md:text-xl font-bold text-white tracking-tight">DNS <span className="text-[#38BDF8]">Dashboard</span></span>
                        </a>

                        {/* Desktop Navigation */}
                    </div>

                    {/* Right Side: CTA & Mobile Menu Toggle */}
                    <div className="flex items-center gap-4 sm:gap-6">
                        <div className="hidden sm:flex items-center gap-6 mr-2">
                            {!isLoggedIn && <Link to="/login" className="text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white transition-colors">Login</Link>}
                        </div>
                        <Link
                            to={isLoggedIn ? "/dashboard" : "/login"}
                            className={`${isLoggedIn
                                ? "bg-[#1A1A1A] text-white hover:bg-[#FFD23F] hover:text-[#1A1A1A]"
                                : "bg-[#FFD23F] text-[#1A1A1A] hover:bg-white hover:text-[#1A1A1A]"
                                } px-4 py-2 md:px-6 md:py-2.5 font-bold uppercase text-xs md:text-sm tracking-widest border-2 border-white transition-all duration-150 shadow-[4px_4px_0px_0px_white] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px] flex items-center gap-2 group`}
                        >
                            {isLoggedIn && <LayoutDashboard className="w-4 h-4 group-hover:rotate-12 transition-transform" />}
                            <span>{isLoggedIn ? "Dashboard" : "Get Started"}</span>
                        </Link>

                        {/* Mobile Toggle */}
                        <button
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            className="xl:hidden p-2 text-gray-400 hover:text-white transition-colors"
                        >
                            <div className="w-6 h-5 relative flex flex-col justify-between overflow-hidden">
                                <span className={`w-full h-0.5 bg-current transition-all duration-300 ${isMenuOpen ? 'rotate-45 translate-y-2' : ''}`}></span>
                                <span className={`w-full h-0.5 bg-current transition-all duration-300 ${isMenuOpen ? 'opacity-0 translate-x-10' : ''}`}></span>
                                <span className={`w-full h-0.5 bg-current transition-all duration-300 ${isMenuOpen ? '-rotate-45 -translate-y-2' : ''}`}></span>
                            </div>
                        </button>
                    </div>
                </div>

                {/* Mobile Menu */}
                <div className={`xl:hidden absolute top-full left-0 right-0 bg-[#1A1A1A] border-b border-white/5 transition-all duration-500 overflow-hidden ${isMenuOpen ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'}`}>
                    <nav className="p-8 flex flex-col gap-6 text-center">
                        {!isLoggedIn && <Link to="/login" onClick={() => setIsMenuOpen(false)} className="text-xs font-bold uppercase tracking-widest text-[#FFD23F]">Login</Link>}
                    </nav>
                </div>
            </header>

            {/* Hero Section */}
            <section className="relative w-full min-h-screen flex flex-col justify-center pt-20 pb-12 bg-[#1A1A1A] bg-[url('/pixel_art_large.png')] bg-cover bg-center bg-no-repeat overflow-hidden border-b border-[#333]">
                <div className="absolute inset-0 bg-black/60 z-0"></div>

                <div className="relative z-10 w-full px-6 md:px-12 lg:px-16 flex-1 flex flex-col justify-center items-center text-center">
                    <div className="max-w-5xl mx-auto space-y-8">
                        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight text-white tracking-tight">
                            Modern DNS Hosting<br />
                            <span className="text-[#38BDF8]">for Everyone.</span>
                        </h1>
                        <p className="text-lg md:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed font-light">
                            DNS Dashboard is a self-hosted DNS management panel, designed with security in mind.<br className="hidden md:block" />
                            Running on <span className="font-bold text-[#FFD23F] font-mono">open-source software</span> (PowerDNS).
                        </p>

                        <div className="pt-4">
                            <Link
                                to="/dashboard"
                                className="inline-flex bg-[#FFD23F] text-[#1A1A1A] py-4 px-8 font-bold uppercase text-sm hover:bg-white hover:text-[#1A1A1A] transition-all shadow-[4px_4px_0px_0px_white] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] items-center gap-2 border-2 border-transparent"
                            >
                                Start Managing Now <ArrowRight className="w-5 h-5" />
                            </Link>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default Landing;
