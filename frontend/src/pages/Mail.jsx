import React, { useState, useEffect } from 'react';
import { getMailDomains, addMailDomain, deleteMailDomain } from '../services/api';
import api from '../services/api';
import { Plus, Mail, Loader2, Trash2, CheckCircle, AlertCircle } from 'lucide-react';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

const MailPage = () => {
    const toast = useToast();
    const [domains, setDomains] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [newDomain, setNewDomain] = useState('');
    const [adding, setAdding] = useState(false);
    const [mxHost, setMxHost] = useState('');
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

    useEffect(() => {
        fetchDomains();
        api.get('/config').then(res => setMxHost(res.data.mxHost || '')).catch(() => {});
    }, []);

    const fetchDomains = async () => {
        try {
            const data = await getMailDomains();
            setDomains(data.domains);
            setError(null);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to load mail domains');
        } finally {
            setLoading(false);
        }
    };

    const handleAdd = async (e) => {
        e.preventDefault();
        if (!newDomain.trim()) return;
        setAdding(true);
        try {
            const res = await addMailDomain(newDomain.trim());
            setNewDomain('');
            toast.success(res.mx ? `Mail domain added + MX record → ${res.mx}` : 'Mail domain added');
            fetchDomains();
        } catch (err) {
            toast.error(err.response?.data?.error || err.message);
        } finally {
            setAdding(false);
        }
    };

    const handleDelete = (domain) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Remove Mail Domain',
            message: `Stop receiving mail for ${domain}?`,
            onConfirm: async () => {
                try {
                    await deleteMailDomain(domain);
                    toast.success('Mail domain removed');
                    fetchDomains();
                } catch (err) {
                    toast.error(err.response?.data?.error || err.message);
                }
            }
        });
    };

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                onConfirm={confirmDialog.onConfirm}
                title={confirmDialog.title}
                message={confirmDialog.message}
                confirmText={confirmDialog.confirmText}
            />

            <div>
                <h1 className="text-3xl font-bold text-white mb-2">Mail Domains</h1>
                <p className="text-gray-400 text-sm">
                    Domains this server accepts mail for (Postfix catch-all → webhook).
                    {mxHost
                        ? <> MX records are auto-created pointing to <span className="text-[#38BDF8] font-mono">{mxHost}</span> when the zone exists.</>
                        : <> Set <span className="text-[#38BDF8]">MX Hostname</span> in Settings to auto-create MX records.</>}
                </p>
            </div>

            <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-[#38BDF8]/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                <form onSubmit={handleAdd} className="flex gap-3 mb-6">
                    <input
                        type="text"
                        value={newDomain}
                        onChange={(e) => setNewDomain(e.target.value)}
                        placeholder="example.com"
                        className="flex-1 bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                    />
                    <button
                        type="submit"
                        disabled={adding}
                        className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] disabled:opacity-50"
                    >
                        {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Add Domain
                    </button>
                </form>

                {loading ? (
                    <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 text-[#38BDF8] animate-spin" /></div>
                ) : error ? (
                    <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                        <div>
                            {error}
                            <p className="text-xs text-gray-500 mt-2">
                                Requires the mail-domain script on this server and a sudoers NOPASSWD rule for the backend user.
                            </p>
                        </div>
                    </div>
                ) : domains.length === 0 ? (
                    <div className="py-12 text-center text-gray-500 text-sm italic border border-dashed border-white/10 rounded-xl">
                        No mail domains yet
                    </div>
                ) : (
                    <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
                        {domains.map(d => (
                            <div key={d} className="px-4 py-3 flex items-center gap-3 bg-black/20 hover:bg-white/[0.03] transition-colors">
                                <Mail className="w-4 h-4 text-[#38BDF8] shrink-0" />
                                <span className="flex-1 text-sm font-mono text-white">{d}</span>
                                <span className="text-[10px] text-gray-500 font-mono uppercase">catch-all</span>
                                <button
                                    onClick={() => handleDelete(d)}
                                    className="text-gray-500 hover:text-red-400 transition-colors p-1.5"
                                    title="Remove"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MailPage;
