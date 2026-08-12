import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { User, Mail, Lock, Shield, Key, Loader2, CheckCircle, AlertCircle, Server, Globe } from 'lucide-react';
import { motion } from 'framer-motion';

const Settings = () => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    // Profile State
    const [profile, setProfile] = useState({ name: '', email: '' });
    const [profileLoading, setProfileLoading] = useState(false);
    const [profileMessage, setProfileMessage] = useState({ type: '', text: '' });

    // PowerDNS Config State
    const [config, setConfig] = useState({ pdnsApiUrl: '', pdnsApiKey: '', pdnsServerId: '', zoneKind: 'Native', ns1: '', ns2: '', masterAddress: '', secondaries: '[]', mxHost: '', mailAgentUrl: '', mailAgentToken: '', pdnsConnected: false });
    const [secondariesText, setSecondariesText] = useState('');

    // Mail forwarder state
    const [forwarder, setForwarder] = useState({ target_url: '', auth_token: '', body_format: 'raw', handler: '', headers: '' });
    const [handlers, setHandlers] = useState([]);
    const [fwdLoading, setFwdLoading] = useState(false);
    const [fwdMessage, setFwdMessage] = useState({ type: '', text: '' });
    const [configLoading, setConfigLoading] = useState(false);
    const [configMessage, setConfigMessage] = useState({ type: '', text: '' });

    // Password Change State
    const [passwords, setPasswords] = useState({ old: '', new: '' });
    const [passLoading, setPassLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });

    useEffect(() => {
        fetchUser();
        fetchConfig();
        fetchForwarder();
    }, []);

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

    const fetchConfig = async () => {
        try {
            const res = await api.get('/config');
            setConfig(res.data);
            // JSON [{name, apiUrl, apiKey}] -> line format for display in the textarea
            setSecondariesText(
                (res.data.secondaryList || [])
                    .map(s => `${s.name || ''}, ${s.apiUrl}, ${s.apiKey}`)
                    .join('\n')
            );
        } catch (error) {
            console.error("Failed to fetch config", error);
        }
    };

    const handleSaveConfig = async (e) => {
        e.preventDefault();
        setConfigMessage({ type: '', text: '' });
        try {
            setConfigLoading(true);
            // Parse textarea: each line is "name, apiUrl, apiKey"
            const secondaryList = secondariesText
                .split('\n')
                .map(line => line.trim())
                .filter(Boolean)
                .map(line => {
                    const [name, apiUrl, apiKey] = line.split(',').map(s => s.trim());
                    return { name, apiUrl, apiKey };
                });
            if (secondaryList.some(s => !s.apiUrl || !s.apiKey)) {
                setConfigMessage({ type: 'error', text: 'Each secondary needs all of: name, apiUrl, apiKey' });
                setConfigLoading(false);
                return;
            }
            const res = await api.put('/config', {
                pdnsApiUrl: config.pdnsApiUrl,
                pdnsApiKey: config.pdnsApiKey,
                pdnsServerId: config.pdnsServerId,
                zoneKind: config.zoneKind,
                ns1: config.ns1,
                ns2: config.ns2,
                masterAddress: config.masterAddress,
                mxHost: config.mxHost,
                mailAgentUrl: config.mailAgentUrl,
                mailAgentToken: config.mailAgentToken,
                secondaries: JSON.stringify(secondaryList)
            });
            setConfigMessage({ type: 'success', text: 'Configuration saved' });
            // Refresh to update the connection status
            const refreshed = await api.get('/config');
            setConfig(refreshed.data);
        } catch (err) {
            setConfigMessage({ type: 'error', text: err.response?.data?.error || 'Failed to save configuration' });
        } finally {
            setConfigLoading(false);
        }
    };

    const fetchUser = async () => {
        try {
            const res = await api.get('/auth/me');
            setUser(res.data);
            setProfile({ name: res.data.name || '', email: res.data.email || '' });
        } catch (error) {
            console.error("Failed to fetch user", error);
        } finally {
            setLoading(false);
        }
    };

    const handleUpdateProfile = async (e) => {
        e.preventDefault();
        setProfileMessage({ type: '', text: '' });

        if (!profile.name || !profile.email) {
            setProfileMessage({ type: 'error', text: 'Please fill in all fields' });
            return;
        }

        try {
            setProfileLoading(true);
            const res = await api.put('/auth/profile', {
                name: profile.name,
                email: profile.email
            });
            setUser(res.data);
            setProfileMessage({ type: 'success', text: 'Profile updated successfully' });
        } catch (err) {
            setProfileMessage({ type: 'error', text: err.response?.data?.error || 'Failed to update profile' });
        } finally {
            setProfileLoading(false);
        }
    };

    const handleUpdatePassword = async (e) => {
        e.preventDefault();
        setMessage({ type: '', text: '' });

        if (!passwords.old || !passwords.new) {
            setMessage({ type: 'error', text: 'Please fill in all fields' });
            return;
        }

        if (passwords.new.length < 8) {
            setMessage({ type: 'error', text: 'New password must be at least 8 characters' });
            return;
        }

        try {
            setPassLoading(true);
            await api.post('/auth/change-password', {
                oldPassword: passwords.old,
                newPassword: passwords.new
            });
            setMessage({ type: 'success', text: 'Password updated successfully' });
            setPasswords({ old: '', new: '' });
        } catch (err) {
            setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to update password' });
        } finally {
            setPassLoading(false);
        }
    };

    if (loading) return <div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-[#38BDF8] animate-spin" /></div>;

    return (
        <div className="space-y-8 max-w-4xl mx-auto">
            <div>
                <h1 className="text-3xl font-bold text-white mb-2">Account Settings</h1>
                <p className="text-gray-400 text-sm">Manage your profile and security preferences.</p>
            </div>

            {/* Profile Card */}
            <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8">
                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <User className="w-5 h-5 text-[#38BDF8]" /> Profile Information
                </h2>

                <form onSubmit={handleUpdateProfile}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Full Name</label>
                            <div className="flex items-center gap-3 bg-black/20 rounded-xl border border-white/5 focus-within:border-[#38BDF8] transition-all">
                                <User className="w-5 h-5 text-gray-500 ml-3" />
                                <input
                                    type="text"
                                    value={profile.name}
                                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                                    className="w-full bg-transparent p-3 pl-0 text-gray-300 focus:outline-none"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Email Address</label>
                            <div className="flex items-center gap-3 bg-black/20 rounded-xl border border-white/5 focus-within:border-[#38BDF8] transition-all">
                                <Mail className="w-5 h-5 text-gray-500 ml-3" />
                                <input
                                    type="email"
                                    value={profile.email}
                                    onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                                    className="w-full bg-transparent p-3 pl-0 text-gray-300 focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {profileMessage.text && (
                        <div className={`mt-4 p-3 rounded-lg flex items-center gap-2 text-sm ${profileMessage.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                            {profileMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                            {profileMessage.text}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={profileLoading}
                        className="mt-6 bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] disabled:opacity-50"
                    >
                        {profileLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Save Profile
                    </button>
                </form>
            </div>

            {/* Security Section */}
            <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-[#38BDF8]/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <Shield className="w-5 h-5 text-[#38BDF8]" /> Security
                </h2>

                <div className="max-w-md">
                    <h3 className="text-sm font-bold text-gray-300 mb-4">Change Password</h3>

                    {message.text && (
                        <div className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-sm ${message.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                            }`}>
                            {message.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                            {message.text}
                        </div>
                    )}

                    <form onSubmit={handleUpdatePassword} className="space-y-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Current Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                <input
                                    type="password"
                                    value={passwords.old}
                                    onChange={(e) => setPasswords({ ...passwords, old: e.target.value })}
                                    className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">New Password</label>
                            <div className="relative">
                                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                <input
                                    type="password"
                                    value={passwords.new}
                                    onChange={(e) => setPasswords({ ...passwords, new: e.target.value })}
                                    className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600"
                                    placeholder="Min 8 characters"
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={passLoading}
                            className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] disabled:opacity-50"
                        >
                            {passLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                            Update Password
                        </button>
                    </form>
                </div>
            </div>

            {/* PowerDNS & Nameservers Section */}
            <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-[#10B981]/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    <Server className="w-5 h-5 text-[#38BDF8]" /> PowerDNS &amp; Nameservers
                    <span className={`ml-2 text-xs font-mono px-2 py-0.5 rounded-full border ${config.pdnsConnected ? 'text-[#10B981] border-[#10B981]/30 bg-[#10B981]/10' : 'text-red-400 border-red-500/30 bg-red-500/10'}`}>
                        {config.pdnsConnected ? '● Connected' : '● Disconnected'}
                    </span>
                </h2>

                {configMessage.text && (
                    <div className={`mb-4 max-w-2xl p-3 rounded-lg flex items-center gap-2 text-sm ${configMessage.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                        }`}>
                        {configMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                        {configMessage.text}
                    </div>
                )}

                <form onSubmit={handleSaveConfig} className="space-y-4 max-w-2xl">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">PowerDNS API URL</label>
                            <input
                                type="text"
                                value={config.pdnsApiUrl}
                                onChange={(e) => setConfig({ ...config, pdnsApiUrl: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="http://127.0.0.1:8081"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">API Key</label>
                            <input
                                type="password"
                                value={config.pdnsApiKey}
                                onChange={(e) => setConfig({ ...config, pdnsApiKey: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="••••••••"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Server ID</label>
                            <input
                                type="text"
                                value={config.pdnsServerId}
                                onChange={(e) => setConfig({ ...config, pdnsServerId: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="localhost"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Zone Kind</label>
                            <select
                                value={config.zoneKind}
                                onChange={(e) => setConfig({ ...config, zoneKind: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all font-mono text-sm"
                            >
                                <option value="Native">Native</option>
                                <option value="Master">Master (replicate to secondaries)</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                <Globe className="w-3 h-3" /> Nameserver 1
                            </label>
                            <input
                                type="text"
                                value={config.ns1}
                                onChange={(e) => setConfig({ ...config, ns1: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="ns1.example.com"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                                <Globe className="w-3 h-3" /> Nameserver 2
                            </label>
                            <input
                                type="text"
                                value={config.ns2}
                                onChange={(e) => setConfig({ ...config, ns2: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="ns2.example.com"
                            />
                        </div>
                    </div>

                    {/* Secondary (slave) servers */}
                    <div className="border-t border-white/5 pt-4 space-y-4">
                        <div className="space-y-1.5 max-w-md">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Master Address (secondaries AXFR from this address)</label>
                            <input
                                type="text"
                                value={config.masterAddress}
                                onChange={(e) => setConfig({ ...config, masterAddress: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="10.89.0.2"
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Secondary Servers (slave)</label>
                            <p className="text-gray-500 text-xs">
                                One server per line: <code className="text-[#38BDF8] font-mono">name, apiUrl, apiKey</code> — zones created/deleted on the master will automatically create/delete slave zones on these servers.
                            </p>
                            <textarea
                                value={secondariesText}
                                onChange={(e) => setSecondariesText(e.target.value)}
                                rows={3}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="ns2, http://127.0.0.1:8082, e2e-secret-key"
                            />
                        </div>
                    </div>

                    {/* Mail (remote agent on the mail server) */}
                    <div className="border-t border-white/5 pt-4 space-y-4">
                        <div className="space-y-1.5 max-w-md">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">MX Hostname (mail receiver)</label>
                            <p className="text-gray-500 text-xs">
                                e.g. <code className="text-[#38BDF8] font-mono">mx.example.com</code> — when adding a mail domain in the Mail tab, an MX record pointing here is auto-created if the zone exists. Empty = off.
                            </p>
                            <input
                                type="text"
                                value={config.mxHost}
                                onChange={(e) => setConfig({ ...config, mxHost: e.target.value })}
                                className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                placeholder="mx.example.com"
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Mail Agent URL</label>
                                <input
                                    type="text"
                                    value={config.mailAgentUrl}
                                    onChange={(e) => setConfig({ ...config, mailAgentUrl: e.target.value })}
                                    className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                    placeholder="http://<mail-server>:9099"
                                />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Agent Token</label>
                                <input
                                    type="password"
                                    value={config.mailAgentToken}
                                    onChange={(e) => setConfig({ ...config, mailAgentToken: e.target.value })}
                                    className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600 font-mono text-sm"
                                    placeholder="••••••••"
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={configLoading}
                        className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] disabled:opacity-50"
                    >
                        {configLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                        Save Configuration
                    </button>
                </form>
            </div>

            {/* Mail Forwarder (webhook hoặc command tuỳ chỉnh trên mail server) */}
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

export default Settings;
