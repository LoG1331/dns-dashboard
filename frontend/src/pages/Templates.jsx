import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getTemplates, createTemplate } from '../services/api';
import { Plus, LayoutTemplate, ArrowRight, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useToast } from '../components/Toast';

const Templates = () => {
    const toast = useToast();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const [isInputFocused, setIsInputFocused] = useState(false);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const fetchTemplates = async () => {
        try {
            setTemplates(await getTemplates());
        } catch {
            toast.error('Failed to fetch templates');
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!newName.trim()) return;

        try {
            setCreating(true);
            const created = await createTemplate({ name: newName, records: [] });
            setNewName('');
            setIsInputFocused(false);
            toast.success(`Template "${created.name}" created`);
            fetchTemplates();
        } catch (err) {
            toast.error('Failed to create template: ' + (err.response?.data?.error || err.message));
        } finally {
            setCreating(false);
        }
    };

    return (
        <div className="h-full flex flex-col gap-4 md:gap-8 pb-2">
            {/* Header & Add Template — same as Dashboard */}
            <div className="shrink-0">
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-6 relative z-10">
                    <div className="hidden md:block">
                        <h1 className="text-4xl font-extrabold text-white mb-2 tracking-tight drop-shadow-lg">Zone Templates</h1>
                        <p className="text-gray-200 text-base drop-shadow-md font-medium">Reusable record sets applied when adding a domain.</p>
                    </div>

                    <div className="flex flex-col items-stretch md:items-end gap-3 pointer-events-auto relative w-full md:w-auto">
                        <form onSubmit={handleCreate} className={`flex items-center gap-2 bg-[#1a1a1a] border p-1.5 rounded-xl shadow-xl shadow-black/20 transition-all duration-300 ${isInputFocused ? 'border-[#38BDF8]/50 ring-1 ring-[#38BDF8]/50' : 'border-white/10'}`}>
                            <div className="relative flex-1">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                    <LayoutTemplate className={`h-4 w-4 transition-colors ${isInputFocused ? 'text-[#38BDF8]' : 'text-gray-400'}`} />
                                </div>
                                <input
                                    type="text"
                                    placeholder="Template name"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    onFocus={() => setIsInputFocused(true)}
                                    className="bg-transparent border-none text-white pl-10 pr-4 py-2 focus:outline-none placeholder:text-gray-500 w-full md:w-64 text-sm font-medium"
                                    disabled={creating}
                                />
                            </div>
                            <button
                                type="submit"
                                disabled={creating}
                                className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-3 md:px-5 py-2 rounded-lg font-bold flex items-center gap-2 transition-all shadow-lg shadow-[#38BDF8]/20 disabled:opacity-50 text-xs md:text-sm whitespace-nowrap"
                            >
                                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                <span className="hidden sm:inline">Add Template</span>
                                <span className="sm:hidden">Add</span>
                            </button>
                        </form>
                    </div>
                </div>
            </div>

            {/* Template List — same as the zone list in Dashboard */}
            <div className="flex-1 md:min-h-0">
                <div className="md:h-full md:overflow-y-auto pr-2 custom-scrollbar">
                    {loading ? (
                        <div className="flex justify-center py-20">
                            <Loader2 className="w-10 h-10 text-[#38BDF8] animate-spin" />
                        </div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {templates.map((t, index) => (
                                <motion.div
                                    key={t.id}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                >
                                    <Link to={`/templates/${t.id}`} className="block group">
                                        <div className="bg-[#1a1a1a]/60 backdrop-blur-xl border border-white/5 rounded-2xl p-5 hover:bg-[#1a1a1a]/90 hover:border-[#38BDF8]/50 transition-all duration-300 relative overflow-hidden group-hover:shadow-[0_0_30px_-10px_rgba(56,189,248,0.15)] flex items-center justify-between gap-6">
                                            <div className="flex items-center gap-6 flex-1 relative z-10 min-w-0">
                                                <div className="min-w-0">
                                                    <h3 className="text-xl font-bold text-white mb-1.5 group-hover:text-[#38BDF8] transition-colors truncate">
                                                        {t.name}
                                                    </h3>
                                                <div className="flex items-center gap-4 text-xs font-bold text-gray-400 uppercase tracking-widest">
                                                        <span className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded border border-white/5">
                                                            <LayoutTemplate className="w-3 h-3" />
                                                            {t.records.length} Records
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="hidden md:flex items-center px-4 py-2 rounded-lg bg-white/5 border border-white/5 text-sm font-bold text-gray-300 group-hover:bg-[#38BDF8] group-hover:text-white group-hover:border-[#38BDF8] transition-all">
                                                Edit
                                                <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                                            </div>
                                        </div>
                                    </Link>
                                </motion.div>
                            ))}

                            {/* Empty State */}
                            {templates.length === 0 && (
                                <div className="py-24 text-center bg-[#1a1a1a]/40 border border-dashed border-white/10 rounded-2xl backdrop-blur-md">
                                    <div className="w-20 h-20 bg-gradient-to-br from-gray-800 to-black rounded-full flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-xl">
                                        <LayoutTemplate className="w-10 h-10 text-gray-400" />
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-3">No templates yet</h3>
                                    <p className="text-gray-400 max-w-md mx-auto text-sm leading-relaxed mb-8">
                                        Create a template to quickly apply a set of records when adding new domains.
                                    </p>
                                    <button
                                        onClick={() => document.querySelector('input[placeholder="Template name"]')?.focus()}
                                        className="text-[#38BDF8] font-bold hover:underline"
                                    >
                                        Add a template now &rarr;
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

export default Templates;
