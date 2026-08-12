import React, { useState, useEffect } from 'react';
import { getMailDomains, addMailDomain, deleteMailDomain } from '../services/api';
import api from '../services/api';
import { Plus, Mail, Loader2, Trash2, CheckCircle, AlertCircle, Server } from 'lucide-react';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

const TOKEN_MASK = '••••••••';

const MailPage = () => {
    const toast = useToast();
    const [domains, setDomains] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [newDomain, setNewDomain] = useState('');
    const [adding, setAdding] = useState(false);
    const [mxHost, setMxHost] = useState('');
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

    // Mail server config state
    const [serverConfig, setServerConfig] = useState({ mxHost: '', mailAgentUrl: '', mailAgentToken: '' });
    const [serverLoading, setServerLoading] = useState(false);
    const [serverMessage, setServerMessage] = useState({ type: '', text: '' });

    // Mail forwarder state
    const [forwarder, setForwarder] = useState({ target_url: '', auth_token: '', body_format: 'raw', handler: '', headers: '' });
    const [handlers, setHandlers] = useState([]);
    const [fwdLoading, setFwdLoading] = useState(false);
    const [fwdMessage, setFwdMessage] = useState({ type: '', text: '' });

    useEffect(() => {
        fetchDomains();
        fetchServerConfig();
        fetchForwarder();
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

    const fetchServerConfig = async () => {
        try {
            const res = await api.get('/config');
            setServerConfig({
                mxHost: res.data.mxHost || '',
                mailAgentUrl: res.data.mailAgentUrl || '',
                mailAgentToken: res.data.mailAgentToken || '',
            });
            setMxHost(res.data.mxHost || '');
        } catch {
            // config unavailable — skip
        }
    };

    const handleSaveServer = async (e) => {
        e.preventDefault();
        setServerMessage({ type: '', text: '' });
        setServerLoading(true);
        try {
            const body = { mxHost: serverConfig.mxHost, mailAgentUrl: serverConfig.mailAgentUrl };
            if (serverConfig.mailAgentToken && serverConfig.mailAgentToken !== TOKEN_MASK) {
                body.mailAgentToken = serverConfig.mailAgentToken;
            }
            await api.put('/config', body);
            setServerMessage({ type: 'success', text: 'Mail server config saved' });
            fetchServerConfig();
        } catch (err) {
            setServerMessage({ type: 'error', text: err.response?.data?.error || err.message });
        } finally {
            setServerLoading(false);
        }
    };

    const fetchForwarder = async () => {
        try {
            const res = await api.get('/mail/forwarder');
            setForwarder({
                target_url: res.data.target_url || '',
                auth_token: res.data.auth_token || '',
                body_format: res.data.body_format || 'raw',
                handler: res.data.handler || '',
                headers: Object.entries(res.data.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n'),
            });
            setHandlers(res.data.handlers || []);
        } catch {
            // agent not configured — skip
        }
    };

    const handleSaveForwarder = async (e) => {
        e.preventDefault();
        setFwdMessage({ type: '', text: '' });
        setFwdLoading(true);
        try {
            const body = { worker_name: 'postfix' };
            if (forwarder.target_url) body.target_url = forwarder.target_url;
            if (forwarder.auth_token) body.auth_token = forwarder.auth_token;
            body.body_format = forwarder.body_format || 'raw';
            if (forwarder.handler) body.handler = forwarder.handler;
            const headers = {};
            for (const line of forwarder.headers.split('\n')) {
                const i = line.indexOf(':');
                if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
            }
            if (Object.keys(headers).length) body.headers = headers;
            await api.put('/mail/forwarder', body);
            setFwdMessage({ type: 'success', text: 'Forwarder config saved' });
        } catch (err) {
            setFwdMessage({ type: 'error', text: err.response?.data?.error || err.message });
        } finally {
            setFwdLoading(false);
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
                        : <> Set <span className="text-[#38BDF8]">MX Hostname</span> in the Mail Server section below to auto-create MX records.</>}
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

            {/* Mail Server (remote agent on the mail server) */}
            <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-[#38BDF8]/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Server className="w-5 h-5 text-[#38BDF8]" /> Mail Server
                </h2>
                <p className="text-gray-400 text-sm mb-6">
                    Connection to the mail agent running on the mail server, plus the MX hostname used for auto-created MX records.
                </p>

                {serverMessage.text && (
                    <div className={`mb-4 max-w-2xl p-3 rounded-lg flex items-center gap-2 text-sm ${serverMessage.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                        {serverMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        {serverMessage.text}
                    </div>
                )}

                <form onSubmit={handleSaveServer} className="space-y-4 max-w-2xl">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">MX Hostname (mail receiver)</label>
                        <p className="text-gray-500 text-xs">
                            e.g. <code className="text-[#38BDF8] font-mono">mx.example.com</code> — when adding a mail domain above, an MX record pointing here is auto-created if the zone exists. Empty = off.
                        </p>
                        <input
                            type="text"
                            value={serverConfig.mxHost}
                            onChange={(e) => setServerConfig({ ...serverConfig, mxHost: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                            placeholder="mx.example.com"
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Mail Agent URL</label>
                            <input
                                type="text"
                                value={serverConfig.mailAgentUrl}
                                onChange={(e) => setServerConfig({ ...serverConfig, mailAgentUrl: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="http://<mail-server>:9099"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Agent Token</label>
                            <input
                                type="password"
                                value={serverConfig.mailAgentToken}
                                onChange={(e) => setServerConfig({ ...serverConfig, mailAgentToken: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="••••••••"
                            />
                        </div>
                    </div>
                    <button
                        type="submit"
                        disabled={serverLoading}
                        className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] disabled:opacity-50"
                    >
                        {serverLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Save Mail Server
                    </button>
                </form>
            </div>

            {/* Mail Forwarder (webhook or custom handler on the mail server) */}
            <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-[#C485FB]/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                <h2 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
                    <Mail className="w-5 h-5 text-[#38BDF8]" /> Mail Forwarder
                </h2>
                <p className="text-gray-400 text-sm mb-6">
                    What happens when mail arrives. Choose a webhook target and/or a custom command on the mail server (raw message on stdin, envelope via env vars).
                </p>

                {fwdMessage.text && (
                    <div className={`mb-4 max-w-2xl p-3 rounded-lg flex items-center gap-2 text-sm ${fwdMessage.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                        {fwdMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        {fwdMessage.text}
                    </div>
                )}

                <form onSubmit={handleSaveForwarder} className="space-y-4 max-w-2xl">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Webhook URL</label>
                        <input
                            type="text"
                            value={forwarder.target_url}
                            onChange={(e) => setForwarder({ ...forwarder, target_url: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                            placeholder="https://your-app/v1/inbound/email"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Webhook Token (optional)</label>
                        <input
                            type="password"
                            value={forwarder.auth_token}
                            onChange={(e) => setForwarder({ ...forwarder, auth_token: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                            placeholder="••••••••"
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Body Format</label>
                            <select
                                value={forwarder.body_format}
                                onChange={(e) => setForwarder({ ...forwarder, body_format: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all font-mono text-sm"
                            >
                                <option value="raw">raw (RFC822 as-is)</option>
                                <option value="base64">base64 (JSON envelope)</option>
                                <option value="json">json (parsed fields)</option>
                            </select>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Custom Headers (optional)</label>
                            <textarea
                                value={forwarder.headers}
                                onChange={(e) => setForwarder({ ...forwarder, headers: e.target.value })}
                                rows={1}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="X-Api-Key: abc123"
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Handler (optional)</label>
                        <p className="text-gray-500 text-xs">
                            A pre-installed script on the mail server (<code className="text-[#38BDF8] font-mono">/opt/zoner-mail/handlers/</code>). Raw message via stdin; envelope in <code className="text-[#38BDF8] font-mono">EMAIL_*</code> env vars. For security, only root can install handlers.
                        </p>
                        <select
                            value={forwarder.handler}
                            onChange={(e) => setForwarder({ ...forwarder, handler: e.target.value })}
                            className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all font-mono text-sm"
                        >
                            <option value="">None (webhook only)</option>
                            {handlers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                    </div>
                    <button
                        type="submit"
                        disabled={fwdLoading}
                        className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] disabled:opacity-50"
                    >
                        {fwdLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Save Forwarder
                    </button>
                </form>
            </div>
        </div>
    );
};

export default MailPage;
