import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Settings, LogOut, Menu, X, LayoutTemplate } from 'lucide-react';
import api from '../services/api';

const SidebarItem = ({ icon: Icon, label, to, active }) => (
    <Link to={to} className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group relative overflow-hidden
        ${active
            ? 'text-white font-medium bg-[#38BDF8]/10 border border-[#38BDF8]/20'
            : 'text-gray-400 hover:bg-white/5 hover:text-white'
        }`}>
        {active && <div className="absolute left-0 top-0 bottom-0 w-1 bg-[#38BDF8] shadow-[0_0_10px_#38BDF8]"></div>}
        <Icon className={`w-5 h-5 transition-transform group-hover:scale-110 ${active ? 'text-[#38BDF8]' : ''}`} />
        <span className="">{label}</span>
    </Link>
);

const Layout = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    useEffect(() => {
        const token = localStorage.getItem('token');
        if (!token) {
            navigate('/login');
            return;
        }

        // Validate token (401 → back to login page)
        const checkAuth = async () => {
            try {
                await api.get('/auth/me');
            } catch (error) {
                console.error('Auth check failed:', error);
                localStorage.removeItem('token');
                navigate('/login');
            }
        };

        checkAuth();
    }, [navigate]);

    const handleLogout = () => {
        localStorage.removeItem('token');
        navigate('/login');
    };

    return (
        <div className="flex min-h-screen bg-[#121212] text-white font-sans selection:bg-[#38BDF8] selection:text-white bg-[url('/pixel_art_large.png')] bg-fixed bg-cover">
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm -z-10"></div>

            {/* Mobile Menu Overlay */}
            {isMobileMenuOpen && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}

            {/* Sidebar */}
            <aside className={`w-72 flex flex-col bg-[#1A1A1A]/60 backdrop-blur-xl border-r border-white/5 p-6 fixed h-full z-50 transition-transform duration-300 ${
                isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
            } md:translate-x-0`}>
                <div className="flex items-center justify-between mb-10">
                    <Link to="/" className="flex items-center gap-3 px-2 hover:opacity-80 transition-opacity">
                        <img src="/logo_white.png" alt="Logo" className="h-9 w-auto object-contain" />
                        <h1 className="text-base font-bold text-white tracking-wide leading-tight">DNS <span className="text-[#38BDF8]">Dashboard</span></h1>
                    </Link>
                    <button 
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="md:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <nav className="flex-1 space-y-1">
                    <SidebarItem icon={LayoutDashboard} label="Dashboard" to="/dashboard" active={location.pathname === '/dashboard'} />
                    <SidebarItem icon={LayoutTemplate} label="Templates" to="/templates" active={location.pathname === '/templates'} />
                    <SidebarItem icon={Settings} label="Settings" to="/settings" active={location.pathname === '/settings'} />
                </nav>

                <div className="pt-6 border-t border-white/5">
                    <button
                        onClick={handleLogout}
                        className="flex items-center gap-3 px-4 py-2 w-full rounded-lg text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-all text-sm"
                    >
                        <LogOut className="w-4 h-4" />
                        <span className="font-medium">Sign Out</span>
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 md:ml-72 h-screen overflow-hidden flex flex-col relative">
                {/* Topbar */}
                {/* Mobile menu button (sidebar hidden on mobile) */}
                <button
                    onClick={() => setIsMobileMenuOpen(true)}
                    className="md:hidden fixed top-4 left-4 z-30 p-2 rounded-lg bg-[#1A1A1A]/80 backdrop-blur-md border border-white/10 text-gray-400 hover:text-white transition-colors"
                >
                    <Menu className="w-5 h-5" />
                </button>

                <div className="px-4 md:px-8 py-4 md:py-6 w-full flex-1 overflow-y-auto relative z-0">
                    {children}
                </div>

                <footer className="py-4 text-center shrink-0 border-t border-white/5 bg-[#121212] z-30">
                    <div className="flex items-center justify-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                        <img src="/logo_white.png" alt="Logo" className="h-4 w-auto opacity-90" />
                        <span className="text-white font-bold text-xs">DNS Dashboard</span>
                    </div>
                </footer>
            </main>
        </div>
    );
};

export default Layout;
