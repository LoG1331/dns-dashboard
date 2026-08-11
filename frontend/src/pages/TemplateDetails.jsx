import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { getTemplate, updateTemplate, deleteTemplate } from '../services/api';
import { ArrowLeft, Plus, Trash2, Globe, Loader2, LayoutTemplate, Search, CheckCircle } from 'lucide-react';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';

const RecordBadge = ({ type }) => {
    const colors = {
        A: 'bg-[#003666] text-[#6FB2E8] border-[#004B8D]',
        AAAA: 'bg-[#2A0F45] text-[#C485FB] border-[#441970]',
        CNAME: 'bg-[#0F2D1F] text-[#4CC495] border-[#16432E]',
        TXT: 'bg-[#2B2B2B] text-[#A6A6A6] border-[#404040]',
        MX: 'bg-[#451E11] text-[#F99B7D] border-[#662C19]',
        SRV: 'bg-[#1E3A8A] text-[#93C5FD] border-[#1D4ED8]',
        CAA: 'bg-[#065F46] text-[#6EE7B7] border-[#047857]',
        NS: 'bg-[#2B2B2B] text-[#E0E0E0] border-[#404040]',
        SOA: 'bg-[#1A1A1A] text-[#808080] border-[#333]'
    };
    return (
        <span className={`w-14 text-center inline-block py-0.5 rounded text-[10px] font-mono font-bold border ${colors[type] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>
            {type}
        </span>
    );
};

const inputCls = "w-full bg-black/20 border border-white/10 rounded-xl py-2.5 px-4 text-white focus:border-[#38BDF8] focus:outline-none focus:ring-1 focus:ring-[#38BDF8] transition-all placeholder-gray-600";
const labelCls = "text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 block";

const TemplateDetails = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [template, setTemplate] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [deleting, setDeleting] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', message: '', onConfirm: null });

    // New Record State (copied from ZoneDetails)
    const [recordType, setRecordType] = useState('A');
    const [recordName, setRecordName] = useState('@');
    const [recordContent, setRecordContent] = useState('');
    const [mxPriority, setMxPriority] = useState('10');
    const [srvPriority, setSrvPriority] = useState('10');
    const [srvWeight, setSrvWeight] = useState('5');
    const [srvPort, setSrvPort] = useState('443');
    const [caaFlags, setCaaFlags] = useState('0');
    const [caaTag, setCaaTag] = useState('issue');
    const [recordTTL, setRecordTTL] = useState(3600);
    const [adding, setAdding] = useState(false);

    useEffect(() => {
        fetchTemplate();
    }, [id]);

    const fetchTemplate = async () => {
        try {
            setTemplate(await getTemplate(id));
        } catch (err) {
            setError('Failed to fetch template');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const saveRecords = async (records, successMsg) => {
        try {
            const updated = await updateTemplate(id, { records });
            setTemplate(updated);
            if (successMsg) toast.success(successMsg);
            return true;
        } catch (err) {
            toast.error('Failed to save: ' + (err.response?.data?.error || err.message));
            return false;
        }
    };

    // Copy validation/format logic from ZoneDetails.handleAddRecord
    const handleAddRecord = async (e) => {
        e.preventDefault();

        if (!recordContent.trim()) {
            toast.error('Record content is required');
            return;
        }

        if (recordName.includes('*')) {
            toast.warning('Wildcard records are not allowed');
            return;
        }

        if (parseInt(recordTTL) < 3600) {
            toast.error('TTL must be at least 1 hour (3600 seconds)');
            return;
        }

        if (recordType === 'A') {
            const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
            if (!ipv4Regex.test(recordContent.trim())) {
                toast.error('Invalid IPv4 address format');
                return;
            }
        } else if (recordType === 'AAAA') {
            if (!recordContent.includes(':')) {
                toast.error('Invalid IPv6 address format');
                return;
            }
        } else if (recordType === 'MX') {
            const priority = parseInt(mxPriority);
            if (isNaN(priority) || priority < 0 || priority > 65535) {
                toast.error('MX priority must be a number between 0 and 65535');
                return;
            }
        } else if (recordType === 'SRV') {
            const priority = parseInt(srvPriority);
            const weight = parseInt(srvWeight);
            const port = parseInt(srvPort);
            if (isNaN(priority) || priority < 0 || priority > 65535) {
                toast.error('SRV priority must be a number between 0 and 65535');
                return;
            }
            if (isNaN(weight) || weight < 0 || weight > 65535) {
                toast.error('SRV weight must be a number between 0 and 65535');
                return;
            }
            if (isNaN(port) || port < 1 || port > 65535) {
                toast.error('SRV port must be a number between 1 and 65535');
                return;
            }
        } else if (recordType === 'CAA') {
            const flags = parseInt(caaFlags);
            if (isNaN(flags) || flags < 0 || flags > 255) {
                toast.error('CAA flags must be a number between 0 and 255');
                return;
            }
            if (!['issue', 'issuewild', 'iodef'].includes(caaTag)) {
                toast.error('CAA tag must be issue, issuewild, or iodef');
                return;
            }
        }

        const txtContent = recordType === 'TXT' && !recordContent.startsWith('"')
            ? `"${recordContent}"`
            : recordContent;
        const finalContent =
            recordType === 'MX'
                ? `${mxPriority} ${recordContent}`
                : recordType === 'SRV'
                ? `${srvPriority} ${srvWeight} ${srvPort} ${recordContent}`
                : recordType === 'CAA'
                ? `${caaFlags} ${caaTag} "${recordContent}"`
                : recordType === 'TXT'
                ? txtContent
                : recordContent;

        if (template.records.some(r => r.name === recordName && r.type === recordType && r.content === finalContent)) {
            toast.error('Record already exists in this template');
            return;
        }

        setAdding(true);
        const ok = await saveRecords(
            [...template.records, { type: recordType, name: recordName, content: finalContent, ttl: parseInt(recordTTL) }],
            `${recordType} record added`
        );
        setAdding(false);
        if (!ok) return;

        // Reset form
        setRecordName('@');
        setRecordContent('');
        setMxPriority('10');
        setSrvPriority('10');
        setSrvWeight('5');
        setSrvPort('443');
        setCaaFlags('0');
        setCaaTag('issue');
    };

    const handleDeleteRecord = (record, index) => {
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Record',
            message: `Are you sure you want to delete this ${record.type} record from the template?`,
            onConfirm: async () => {
                await saveRecords(
                    template.records.filter((_, i) => i !== index),
                    `${record.type} record removed`
                );
            }
        });
    };

    const handleDeleteTemplate = () => {
        setConfirmDialog({
            isOpen: true,
            title: 'Delete Template',
            message: `Are you sure you want to delete template "${template.name}"?`,
            onConfirm: async () => {
                setDeleting(true);
                try {
                    await deleteTemplate(id);
                    toast.success('Template deleted');
                    navigate('/templates');
                } catch (err) {
                    toast.error('Failed to delete template: ' + (err.response?.data?.error || err.message));
                    setDeleting(false);
                }
            }
        });
    };

    if (loading) return <div className="flex justify-center p-20"><Loader2 className="w-8 h-8 text-[#38BDF8] animate-spin" /></div>;
    if (error) return <div className="text-red-400 text-center mt-20 text-xl font-bold">{error}</div>;
    if (!template) return <div className="text-white text-center mt-20">Template not found</div>;

    const filteredRecords = template.records.filter(r =>
        !searchQuery ||
        r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.content.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <>
            <ConfirmDialog
                isOpen={confirmDialog.isOpen}
                onClose={() => setConfirmDialog({ ...confirmDialog, isOpen: false })}
                onConfirm={confirmDialog.onConfirm}
                title={confirmDialog.title}
                message={confirmDialog.message}
                confirmText={confirmDialog.confirmText}
            />
            <div className="space-y-6 max-w-7xl mx-auto pb-20">
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                        <Link to="/templates" className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-all border border-white/5 shrink-0">
                            <ArrowLeft className="w-5 h-5" />
                        </Link>
                        <div className="min-w-0">
                            <h1 className="text-3xl font-bold text-white mb-1 flex items-center gap-3">
                                <span className="truncate">{template.name}</span>
                                <span className="text-[11px] px-2.5 py-1 rounded-md uppercase tracking-wider font-bold whitespace-nowrap bg-[#38BDF8]/10 text-[#38BDF8] border border-[#38BDF8]/20">
                                    Template
                                </span>
                            </h1>
                            <p className="text-gray-400 text-sm truncate">
                                {template.records.length} records
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleDeleteTemplate}
                        disabled={deleting}
                        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-50 flex items-center gap-2 shadow-lg shadow-red-900/20 border border-red-500/50 shrink-0"
                    >
                        {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        <span className="hidden sm:inline">{deleting ? 'Deleting...' : 'Delete Template'}</span>
                    </button>
                </div>

                {/* Add Record Card */}
                <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-32 bg-[#38BDF8]/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                    <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                        <Plus className="w-5 h-5 text-[#38BDF8]" /> Add Record
                    </h2>

                    <form onSubmit={handleAddRecord} className="space-y-4 max-w-2xl">
                        {/* Preview Record Name */}
                        {recordName && recordName !== '@' && (
                            <div className="px-4 py-2.5 bg-black/20 border border-[#38BDF8]/30 rounded-xl">
                                <span className="text-[10px] uppercase text-gray-500 font-bold tracking-wider">Record Name</span>
                                <div className="text-sm font-mono text-[#38BDF8] mt-0.5">{recordName}.&lt;domain&gt;</div>
                            </div>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Type */}
                            <div>
                                <label className={labelCls}>Type</label>
                                <select
                                    value={recordType}
                                    onChange={(e) => setRecordType(e.target.value)}
                                    className={`${inputCls} cursor-pointer font-bold`}
                                >
                                    {['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV', 'CAA'].map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>

                            {/* Name */}
                            <div className="relative">
                                <label className={labelCls}>Name</label>
                                <span className="absolute left-4 top-[calc(50%+0.55rem)] -translate-y-1/2 text-gray-500 font-mono text-sm">@</span>
                                <input
                                    type="text"
                                    value={recordName === '@' ? '' : recordName}
                                    onChange={(e) => setRecordName(e.target.value || '@')}
                                    placeholder="name"
                                    className={`${inputCls} pl-8 font-mono`}
                                />
                            </div>

                            {/* TTL */}
                            <div>
                                <label className={labelCls}>TTL</label>
                                <select
                                    value={recordTTL}
                                    onChange={(e) => setRecordTTL(e.target.value)}
                                    className={`${inputCls} cursor-pointer`}
                                    title="Minimum TTL: 1 hour"
                                >
                                    <option value="3600">1 hr</option>
                                    <option value="7200">2 hrs</option>
                                    <option value="21600">6 hrs</option>
                                    <option value="43200">12 hrs</option>
                                    <option value="86400">1 day</option>
                                    <option value="604800">1 week</option>
                                </select>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-4">
                            {/* MX Priority Field */}
                            {recordType === 'MX' && (
                                <div className="w-28">
                                    <label className={labelCls}>Priority</label>
                                    <input
                                        type="number"
                                        value={mxPriority}
                                        onChange={(e) => setMxPriority(e.target.value)}
                                        placeholder="10"
                                        min="0"
                                        max="65535"
                                        className={`${inputCls} font-mono`}
                                        title="Priority (0-65535)"
                                    />
                                </div>
                            )}
                            {/* SRV Fields */}
                            {recordType === 'SRV' && (
                                <>
                                    <div className="w-28">
                                        <label className={labelCls}>Priority</label>
                                        <input
                                            type="number"
                                            value={srvPriority}
                                            onChange={(e) => setSrvPriority(e.target.value)}
                                            placeholder="10"
                                            min="0"
                                            max="65535"
                                            className={`${inputCls} font-mono`}
                                            title="Priority (0-65535)"
                                        />
                                    </div>
                                    <div className="w-28">
                                        <label className={labelCls}>Weight</label>
                                        <input
                                            type="number"
                                            value={srvWeight}
                                            onChange={(e) => setSrvWeight(e.target.value)}
                                            placeholder="5"
                                            min="0"
                                            max="65535"
                                            className={`${inputCls} font-mono`}
                                            title="Weight (0-65535)"
                                        />
                                    </div>
                                    <div className="w-28">
                                        <label className={labelCls}>Port</label>
                                        <input
                                            type="number"
                                            value={srvPort}
                                            onChange={(e) => setSrvPort(e.target.value)}
                                            placeholder="443"
                                            min="1"
                                            max="65535"
                                            className={`${inputCls} font-mono`}
                                            title="Port (1-65535)"
                                        />
                                    </div>
                                </>
                            )}
                            {/* CAA Fields */}
                            {recordType === 'CAA' && (
                                <>
                                    <div className="w-24">
                                        <label className={labelCls}>Flags</label>
                                        <input
                                            type="number"
                                            value={caaFlags}
                                            onChange={(e) => setCaaFlags(e.target.value)}
                                            placeholder="0"
                                            min="0"
                                            max="255"
                                            className={`${inputCls} font-mono`}
                                            title="Flags (0-255, usually 0)"
                                        />
                                    </div>
                                    <div className="w-32">
                                        <label className={labelCls}>Tag</label>
                                        <select
                                            value={caaTag}
                                            onChange={(e) => setCaaTag(e.target.value)}
                                            className={`${inputCls} cursor-pointer`}
                                        >
                                            <option value="issue">issue</option>
                                            <option value="issuewild">issuewild</option>
                                            <option value="iodef">iodef</option>
                                        </select>
                                    </div>
                                </>
                            )}
                            <div className="flex-1 min-w-[200px]">
                                <label className={labelCls}>{recordType === 'CAA' ? 'Value' : 'Content'}</label>
                                <input
                                    type="text"
                                    value={recordContent}
                                    onChange={(e) => setRecordContent(e.target.value)}
                                    placeholder={
                                        recordType === 'A' ? '192.0.2.1' :
                                        recordType === 'AAAA' ? '2001:db8::1' :
                                        recordType === 'CNAME' ? 'example.com' :
                                        recordType === 'MX' ? 'mail.example.com' :
                                        recordType === 'SRV' ? 'target.example.com' :
                                        recordType === 'CAA' ? 'letsencrypt.org' :
                                        recordType === 'TXT' ? 'v=spf1 include:_spf.example.com ~all' :
                                        'content'
                                    }
                                    className={`${inputCls} font-mono`}
                                />
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={adding}
                            className="bg-[#38BDF8] hover:bg-[#0EA5E9] text-white px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(56,189,248,0.2)] disabled:opacity-50"
                        >
                            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                            Add Record
                        </button>
                    </form>
                </div>

                {/* Records List Card */}
                <div className="bg-[#262626]/40 backdrop-blur-md border border-white/5 rounded-2xl p-8 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-32 bg-[#C485FB]/5 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2"></div>

                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-6">
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            <Globe className="w-5 h-5 text-[#38BDF8]" /> Records
                            <span className="text-xs font-mono text-gray-500 font-normal">({template.records.length})</span>
                        </h2>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search records..."
                                className={`${inputCls} pl-10 md:w-64`}
                            />
                        </div>
                    </div>

                    {filteredRecords.length > 0 ? (
                        <div className="divide-y divide-white/5 border border-white/5 rounded-xl overflow-hidden">
                            {filteredRecords.map((r, i) => {
                                const realIndex = template.records.indexOf(r);
                                return (
                                    <div key={i} className="px-4 py-3 flex items-center gap-3 bg-black/20 hover:bg-white/[0.03] transition-colors">
                                        <RecordBadge type={r.type} />
                                        <span className="text-sm font-mono text-white font-bold w-32 truncate">{r.name}</span>
                                        <span className="text-xs text-gray-500 font-mono w-16 shrink-0">{r.ttl}s</span>
                                        <span className="flex-1 text-sm font-mono text-gray-400 truncate" title={r.content}>{r.content}</span>
                                        <button
                                            onClick={() => handleDeleteRecord(r, realIndex)}
                                            className="text-gray-500 hover:text-red-400 transition-colors p-1.5 shrink-0"
                                            title="Delete record"
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="py-12 text-center text-gray-500 text-sm italic border border-dashed border-white/10 rounded-xl">
                            {searchQuery ? 'No matching records' : 'No records yet — add the first one above'}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default TemplateDetails;
