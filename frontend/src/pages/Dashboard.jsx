import React, { useState, useEffect } from 'react';
import { getZones, createZone, getTemplates, syncZones } from '../services/api';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Globe, Activity, ArrowRight, Loader2, Search, Zap, Server, ShieldCheck, ShieldOff, LayoutTemplate, ChevronDown, Check, RefreshCw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useToast } from '../components/Toast';

const Dashboard = () => {
    const toast = useToast();
    const [zones, setZones] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [selectedTemplate, setSelectedTemplate] = useState('');
    const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [newZone, setNewZone] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [creating, setCreating] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [searchParams] = useSearchParams();

    const searchQuery = searchParams.get('q') || '';
    const filteredZones = zones.filter(zone =>
        zone.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    useEffect(() => {
        fetchZones();
        getTemplates().then(setTemplates).catch(() => {});
    }, []);

    const fetchZones = async () => {
        try {
            const data = await getZones();
            setZones(data.zones || data); // Handle new format
        } catch (err) {
            setError('Failed to fetch zones. Please check your connection.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async () => {
        try {
            setSyncing(true);
            const data = await syncZones();
            if (data.imported?.length > 0) {
                toast.success(`Synced ${data.imported.length} zone(s) from PowerDNS`);
            } else {
                toast.success('Everything is up to date');
            }
            fetchZones();
        } catch (err) {
            toast.error('Failed to sync: ' + (err.response?.data?.error || err.message));
        } finally {
            setSyncing(false);
        }
    };

    const handleCreateZone = async (e) => {        e.preventDefault();
        if (!newZone) return;

        try {
            setCreating(true);
            await createZone(newZone, selectedTemplate || null);
            setNewZone('');
            setSelectedTemplate('');
            setIsInputFocused(false); // Reset focus
            toast.success(`Zone "${newZone}" created successfully`);
            fetchZones(); // Refresh list
        } catch (err) {
            toast.error('Failed to create zone: ' + (err.response?.data?.error || err.message));
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="h-full flex flex-col gap-4 md:gap-8 pb-2">
            {/* Fixed Header Section (Title + Stats) - Hidden on mobile, shown on desktop */}
            <div className="shrink-0 space-y-4 md:space-y-8">
                {/* Header & Add Domain */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 relative z-10">
                    <div className="hidden md:block">
                        <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight drop-shadow-lg">Overview</h1>
                        <p className="text-gray-200 text-base drop-shadow-md font-medium">Manage your domains and DNS records.</p>
                    </div>

                    <div className="flex flex-col items-stretch md:items-end gap-3 pointer-events-auto relative w-full md:w-auto">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={handleSync}
                                disabled={syncing}
                                className="bg-[#1a1a1a] border border-white/10 hover:border-[#38BDF8]/50 text-gray-300 hover:text-white p-2.5 rounded-xl transition-all shadow-xl shadow-black/20 disabled:opacity-50"
                                title="Sync zones from PowerDNS"
                            >
                                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin text-[#38BDF8]' : ''}`} />
                            </button>
                            <form onSubmit={handleCreateZone} className={`flex items-center gap-2 bg-[#1a1a1a] border p-1.5 rounded-xl shadow-xl shadow-black/20 transition-all duration-300 ${isInputFocused ? 'border-[#38BDF8]/50 ring-1 ring-[#38BDF8]/50' : 'border-white/10'}`}>
                            <div className="relative flex-1">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <Globe className={`h-4 w-4 transition-colors ${isInputFocused ? 'text-[#38BDF8]' : 'text-gray-400'}`} />
                                </div>
                                <input
                                    type="text"
                                    placeholder="example.com"
                                    value={newZone}
                                    onChange={(e) => setNewZone(e.target.value)}
                                    onFocus={() => setIsInputFocused(true)}
                                    className="bg-transparent border-none text-white pl-10 pr-4 py-2 focus:outline-none placeholder:text-gray-500 w-full md:w-64 text-sm font-medium"
                                    disabled={creating}
                                />
                            </div>
                            {/* Template picker — custom dropdown */}
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setTemplateMenuOpen(o => !o)}
                                    className={`flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-lg border text-xs md:text-sm font-medium transition-all whitespace-nowrap ${
                                        selectedTemplate
                                            ? 'border-[#38BDF8]/40 bg-[#38BDF8]/10 text-[#38BDF8]'
                                            : 'border-white/10 bg-black/40 text-gray-400 hover:text-gray-200 hover:border-white/20'
                                    }`}
                                    title="Zone template"
                                >
                                    <LayoutTemplate className="w-3.5 h-3.5 shrink-0" />
                                    <span className="max-w-[110px] truncate">
                                        {selectedTemplate
                                            ? templates.find(t => t.id === selectedTemplate)?.name || 'Template'
                                            : 'No template'}
                                    </span>
                                    <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${templateMenuOpen ? 'rotate-180' : ''}`} />
                                </button>

                                <AnimatePresence>
                                    {templateMenuOpen && (
                                        <>
                                            {/* Overlay to catch outside clicks */}
                                            <div className="fixed inset-0 z-40" onClick={() => setTemplateMenuOpen(false)} />
                                            <motion.div
                                                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                                transition={{ duration: 0.15 }}
                                                className="absolute right-0 top-full mt-2 z-50 w-56 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden"
                                            >
                                                <div className="px-3 py-2 text-[10px] uppercase font-bold text-gray-500 tracking-wider border-b border-white/5">
                                                    Apply template
                                                </div>
                                                <div className="max-h-64 overflow-y-auto custom-scrollbar p-1">
                                                    <button
                                                        type="button"
                                                        onClick={() => { setSelectedTemplate(''); setTemplateMenuOpen(false); }}
                                                        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                                                            !selectedTemplate ? 'bg-[#38BDF8]/10 text-[#38BDF8]' : 'text-gray-300 hover:bg-white/5'
                                                        }`}
                                                    >
                                                        <span>No template</span>
                                                        {!selectedTemplate && <Check className="w-4 h-4 shrink-0" />}
                                                    </button>
                                                    {templates.map(t => (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            onClick={() => { setSelectedTemplate(t.id); setTemplateMenuOpen(false); }}
                                                            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
                                                                selectedTemplate === t.id ? 'bg-[#38BDF8]/10 text-[#38BDF8]' : 'text-gray-300 hover:bg-white/5'
                                                            }`}
                                                        >
                                                            <span className="truncate">{t.name}</span>
                                                            <span className="flex items-center gap-2 shrink-0">
                                                                <span className="text-[10px] font-mono text-gray-500">{t.records.length} rec</span>
                                                                {selectedTemplate === t.id && <Check className="w-4 h-4" />}
                                                            </span>
                                                        </button>
                                                    ))}
                                                    {templates.length === 0 && (
                                                        <p className="px-3 py-3 text-xs text-gray-500 italic">
                                                            No templates — create one in the Templates tab
                                                        </p>
                                                    )}
                                                </div>
                                            </motion.div>
                                        </>
                                    )}
                                </AnimatePresence>
                            </div>
                            <button
                                type="submit"
                                disabled={creating}
                                className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-3 md:px-5 py-2 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-[#38BDF8]/20 disabled:opacity-50 text-xs md:text-sm whitespace-nowrap"
                            >
                                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                <span className="hidden sm:inline">Add Domain</span>
                                <span className="sm:hidden">Add</span>
                            </button>
                            </form>
                        </div>
                    </div>
                </div>

                {/* Quick Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-6">
                    <StatCard icon={Server} label="Total Zones" value={zones.length} color="bg-blue-500/20 text-blue-400" border="border-blue-500/20" />
                    <StatCard icon={Zap} label="Unverified" value={zones.filter(z => z.status === 'pending' || z.status === 'pending_verification').length} color="bg-pink-500/20 text-pink-400" border="border-pink-500/20" />
                    <StatCard icon={ShieldCheck} label="Active" value={zones.filter(z => z.status === 'active').length} color="bg-emerald-500/20 text-emerald-400" border="border-emerald-500/20" />
                    <StatCard icon={ShieldOff} label="Suspended" value={zones.filter(z => z.status === 'suspended').length} color="bg-red-500/20 text-red-400" border="border-red-500/20" />
                </div>
            </div>

            {/* Scrollable Content Grid */}
            <div className="flex-1 md:min-h-0">
                {/* Zone List Area - Independently Scrollable */}
                <div className="md:h-full md:overflow-y-auto pr-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <Loader2 className="w-10 h-10 text-[#38BDF8] animate-spin" />
                        </div>
                    ) : error ? (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-8 rounded-2xl text-center font-bold">
                            {error}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {filteredZones.map((zone, index) => (
                                <motion.div
                                    key={zone._id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                >
                                    <Link to={`/zones/${zone._id}`} className="block group">
                                        <div className="bg-[#1a1a1a]/60 backdrop-blur-xl border border-white/5 rounded-2xl p-5 hover:bg-[#1a1a1a]/90 hover:border-[#38BDF8]/50 transition-all duration-300 relative overflow-hidden group-hover:shadow-[0_0_30px_-10px_rgba(56,189,248,0.15)] flex items-center justify-between gap-6">

                                            <div className="flex items-center gap-6 flex-1 relative z-10">
                                                <div>
                                                    <h3 className="text-xl font-bold text-white mb-1.5 group-hover:text-[#38BDF8] transition-colors truncate">
                                                        {zone.name}
                                                    </h3>
                                                    <div className="flex items-center gap-4 text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                                                        <span className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded border border-white/5">
                                                            <Server className="w-3 h-3" />
                                                            {zone.records_count || 0} Records
                                                        </span>
                                                        <div className={`flex items-center gap-1.5 px-2 py-1 rounded border ${
                                                            zone.status === 'active' 
                                                                ? 'bg-emerald-500/5 border-emerald-500/10 text-emerald-400' 
                                                                : zone.status === 'suspended' 
                                                                    ? 'bg-red-500/5 border-red-500/10 text-red-400'
                                                                    : 'bg-orange-500/5 border-orange-500/10 text-orange-400'
                                                            }`}>
                                                            <div className={`w-1.5 h-1.5 rounded-full ${
                                                                zone.status === 'active' 
                                                                    ? 'bg-emerald-500' 
                                                                    : zone.status === 'suspended' 
                                                                        ? 'bg-red-500'
                                                                        : 'bg-orange-500'
                                                            }`} />
                                                            {zone.status === 'pending_verification' ? 'Pending Setup' : zone.status === 'suspended' ? 'Suspended' : zone.status}
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-3 text-[10px] font-medium text-gray-400 font-mono opacity-80">
                                                        <span>Created: {new Date(zone.createdAt).toLocaleDateString()}</span>
                                                        <span className="w-1 h-1 rounded-full bg-gray-700"></span>
                                                        <span>Updated: {new Date(zone.updatedAt).toLocaleDateString()}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="hidden md:flex items-center px-4 py-2 rounded-lg bg-white/5 border border-white/5 text-sm font-bold text-gray-300 group-hover:bg-[#38BDF8] group-hover:text-white group-hover:border-[#38BDF8] transition-all">
                                                Manage
                                                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                                            </div>
                                        </div>
                                    </Link>
                                </motion.div>
                            ))}

                            {/* Empty State */}
                            {filteredZones.length === 0 && (
                                <div className="py-24 text-center bg-[#1a1a1a]/40 border border-dashed border-white/10 rounded-2xl backdrop-blur-md">
                                    <div className="w-20 h-20 bg-gradient-to-br from-gray-800 to-black rounded-full flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-xl">
                                        <Activity className="w-10 h-10 text-gray-400" />
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-3">No domains found</h3>
                                    <p className="text-gray-400 max-w-md mx-auto text-sm leading-relaxed mb-8">
                                        Get started by adding your first domain. You can verify it and start managing DNS records instantly.
                                    </p>
                                    <button
                                        onClick={() => document.querySelector('input[placeholder="example.com"]')?.focus()}
                                        className="text-[#38BDF8] font-bold hover:underline"
                                    >
                                        Add a domain now &rarr;
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const StatCard = ({ icon: Icon, label, value, color, border, subtitle }) => (
    <div className={`bg-[#1a1a1a]/60 backdrop-blur-xl border border-white/5 p-2.5 md:p-6 rounded-lg md:rounded-2xl flex flex-col md:flex-row items-center gap-2 md:gap-5 hover:bg-[#1a1a1a]/80 transition-all hover:border-white/10 group shadow-lg`}>
        <div className={`p-1.5 md:p-4 rounded-lg md:rounded-xl ${color} ${border} border group-hover:scale-110 transition-transform`}>
            <Icon className="w-4 h-4 md:w-7 md:h-7" />
        </div>
        <div className="text-center md:text-left">
            <p className="text-gray-500 text-[8px] md:text-[10px] uppercase tracking-wider md:tracking-widest font-bold mb-0.5 md:mb-1">{label}</p>
            <p className="text-lg md:text-3xl font-black text-white">{value}</p>
            {subtitle && <p className="text-gray-400 text-[9px] md:text-xs mt-0.5 md:mt-1">{subtitle}</p>}
        </div>
    </div>
);

export default Dashboard;
