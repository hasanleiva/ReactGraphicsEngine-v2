import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';

interface SyncLog {
  id: number;
  type: string;
  status: string;
  message?: string;
  items_synced: number;
  started_at: string;
  completed_at?: string;
}

interface ConfigItem {
  folder: string;
  template: string;
  config: Record<string, unknown> | null;
  error?: string;
}

interface HealthData {
  db: string;
  matches: number;
  teams: number;
  syncLogs: number;
}

interface TournamentSyncConfig {
  id: number;
  tournament_id: number;
  season_id: number | null;
  matches_interval_minutes: number;
  matches_enabled: boolean;
  events_interval_minutes: number;
  events_enabled: boolean;
  standings_interval_minutes: number;
  standings_enabled: boolean;
}

interface LocalConfig {
  matches_interval_minutes: number;
  matches_enabled: boolean;
  events_interval_minutes: number;
  events_enabled: boolean;
  standings_interval_minutes: number;
  standings_enabled: boolean;
}

const s = {
  page: { minHeight: '100vh', background: '#f3f4f6', fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header: { background: '#1e293b', color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' } as React.CSSProperties,
  title: { margin: 0, fontSize: 20, fontWeight: 700 } as React.CSSProperties,
  backBtn: { background: 'none', border: '1px solid #64748b', color: '#cbd5e1', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 13 } as React.CSSProperties,
  body: { maxWidth: 960, margin: '0 auto', padding: '32px 16px' } as React.CSSProperties,
  tabs: { display: 'flex', gap: 4, marginBottom: 24, borderBottom: '2px solid #e2e8f0' } as React.CSSProperties,
  tab: (active: boolean): React.CSSProperties => ({
    padding: '8px 20px', border: 'none', background: 'none', cursor: 'pointer',
    fontSize: 14, fontWeight: active ? 700 : 400,
    color: active ? '#3b82f6' : '#64748b',
    borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
    marginBottom: -2,
  }),
  card: { background: '#fff', borderRadius: 8, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 16 } as React.CSSProperties,
  label: { display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' as const, letterSpacing: 0.5, marginBottom: 6 },
  input: { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' as const },
  textarea: { width: '100%', minHeight: 200, padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, fontFamily: 'monospace', boxSizing: 'border-box' as const, resize: 'vertical' as const },
  btn: (color = '#3b82f6'): React.CSSProperties => ({ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }),
  smBtn: (color = '#3b82f6'): React.CSSProperties => ({ background: color, color: '#fff', border: 'none', borderRadius: 5, padding: '5px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }),
  outlineBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14, color: '#374151' } as React.CSSProperties,
  badge: (status: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
    background: status === 'success' ? '#dcfce7' : status === 'error' ? '#fee2e2' : status === 'running' ? '#dbeafe' : '#f3f4f6',
    color: status === 'success' ? '#166534' : status === 'error' ? '#991b1b' : status === 'running' ? '#1d4ed8' : '#374151',
  }),
  row: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 16 } as React.CSSProperties,
  toast: (ok: boolean): React.CSSProperties => ({
    padding: '8px 14px', borderRadius: 6, fontSize: 13, marginTop: 8,
    background: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#166534' : '#991b1b',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: { textAlign: 'left' as const, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 600, color: '#374151' } as React.CSSProperties,
  td: { padding: '8px 12px', borderBottom: '1px solid #f1f5f9', color: '#4b5563' } as React.CSSProperties,
  statBox: { textAlign: 'center' as const, padding: '16px 24px', background: '#f8fafc', borderRadius: 8, flex: '1' },
  statNum: { fontSize: 28, fontWeight: 700, color: '#1e293b' } as React.CSSProperties,
  statLbl: { fontSize: 12, color: '#6b7280', marginTop: 4 } as React.CSSProperties,
};

function Toggle({ enabled, onChange }: { enabled: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      title={enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
      style={{
        display: 'inline-flex', alignItems: 'center', cursor: 'pointer', flexShrink: 0,
        width: 44, height: 24, borderRadius: 12,
        background: enabled ? '#10b981' : '#d1d5db',
        position: 'relative', transition: 'background 0.2s',
      }}
    >
      <div style={{
        position: 'absolute', left: enabled ? 22 : 2,
        width: 20, height: 20, borderRadius: '50%',
        background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
        transition: 'left 0.15s',
      }} />
    </div>
  );
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'sync' | 'configs' | 'status' | 'tourDropdowns'>('sync');

  // Config tab state
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<ConfigItem | null>(null);
  const [editJson, setEditJson] = useState('');
  const [configMsg, setConfigMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Global sync state
  const [syncInterval, setSyncInterval] = useState('60');
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [syncScope, setSyncScope] = useState('full');
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Per-tournament sync configs
  const [tConfigs, setTConfigs] = useState<TournamentSyncConfig[]>([]);
  const [localCfg, setLocalCfg] = useState<Record<number, LocalConfig>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [cfgMsgs, setCfgMsgs] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [syncingId, setSyncingId] = useState<Record<string, boolean>>({});
  const [addTId, setAddTId] = useState('');
  const [addSId, setAddSId] = useState('');
  const [adding, setAdding] = useState(false);
  const [addMsg, setAddMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Clear events state
  const [clearTournamentId, setClearTournamentId] = useState('');
  const [clearSeasonId, setClearSeasonId] = useState('');
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Status state
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState('');

  // Tour dropdowns state
  const [tourDropdowns, setTourDropdowns] = useState<{ folder: string; data: unknown[] | null; error?: string }[]>([]);
  const [selectedTourFolder, setSelectedTourFolder] = useState<string | null>(null);
  const [editTourJson, setEditTourJson] = useState('');
  const [tourMsg, setTourMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) navigate('/');
  }, [user, loading, navigate]);

  const loadConfigs = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/configs');
      setConfigs(res.data);
    } catch { /* ignore */ }
  }, []);

  const loadTournamentConfigs = useCallback(async () => {
    try {
      const res = await axios.get<TournamentSyncConfig[]>('/api/admin/tournament-sync-configs');
      setTConfigs(res.data);
      const local: Record<number, LocalConfig> = {};
      for (const c of res.data) {
        local[c.id] = {
          matches_interval_minutes: c.matches_interval_minutes,
          matches_enabled: c.matches_enabled,
          events_interval_minutes: c.events_interval_minutes,
          events_enabled: c.events_enabled,
          standings_interval_minutes: c.standings_interval_minutes,
          standings_enabled: c.standings_enabled,
        };
      }
      setLocalCfg(local);
    } catch { /* ignore */ }
  }, []);

  const loadSyncData = useCallback(async () => {
    try {
      const [settingsRes, logsRes] = await Promise.all([
        axios.get('/api/admin/sync/settings'),
        axios.get('/api/admin/sync/logs'),
      ]);
      setSyncInterval(settingsRes.data.sync_interval_minutes || '60');
      setGlobalEnabled(settingsRes.data.sync_enabled !== 'false');
      setSyncLogs(logsRes.data);
    } catch { /* ignore */ }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/health');
      setHealth(res.data);
      setHealthError('');
    } catch (e: any) {
      setHealthError(e.response?.data?.error || 'Connection failed');
    }
  }, []);

  const loadTourDropdowns = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/tour-dropdowns');
      setTourDropdowns(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (activeTab === 'sync') { loadSyncData(); loadTournamentConfigs(); }
    if (activeTab === 'configs') loadConfigs();
    if (activeTab === 'status') loadHealth();
    if (activeTab === 'tourDropdowns') loadTourDropdowns();
  }, [activeTab, loadConfigs, loadSyncData, loadHealth, loadTourDropdowns, loadTournamentConfigs]);

  // ── Global sync settings ──────────────────────────────────────────────────
  const handleSaveSyncSettings = async () => {
    try {
      await axios.put('/api/admin/sync/settings', {
        sync_interval_minutes: parseInt(syncInterval, 10),
        sync_enabled: globalEnabled,
      });
      setSyncMsg({ ok: true, text: 'Settings saved' });
      loadSyncData();
    } catch (e: any) {
      setSyncMsg({ ok: false, text: e.response?.data?.error || 'Save failed' });
    }
  };

  const handleToggleGlobal = async () => {
    const next = !globalEnabled;
    setGlobalEnabled(next);
    try {
      await axios.put('/api/admin/sync/settings', { sync_enabled: next });
    } catch { setGlobalEnabled(!next); }
  };

  // ── Per-tournament configs ────────────────────────────────────────────────
  const patchLocal = (id: number, patch: Partial<LocalConfig>) => {
    setLocalCfg(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const handleToggleField = async (cfg: TournamentSyncConfig, field: 'matches_enabled' | 'events_enabled' | 'standings_enabled') => {
    const next = !localCfg[cfg.id][field];
    patchLocal(cfg.id, { [field]: next });
    try {
      await axios.put(`/api/admin/tournament-sync-configs/${cfg.id}`, { [field]: next });
    } catch { patchLocal(cfg.id, { [field]: !next }); }
  };

  const handleSaveConfig = async (id: number) => {
    setSavingId(id);
    setCfgMsgs(prev => ({ ...prev, [id]: { ok: true, text: '' } }));
    try {
      await axios.put(`/api/admin/tournament-sync-configs/${id}`, localCfg[id]);
      setCfgMsgs(prev => ({ ...prev, [id]: { ok: true, text: 'Saved' } }));
      loadTournamentConfigs();
    } catch (e: any) {
      setCfgMsgs(prev => ({ ...prev, [id]: { ok: false, text: e.response?.data?.error || 'Save failed' } }));
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteConfig = async (id: number) => {
    try {
      await axios.delete(`/api/admin/tournament-sync-configs/${id}`);
      loadTournamentConfigs();
    } catch { /* ignore */ }
  };

  const handleAddConfig = async () => {
    if (!addTId) return;
    setAdding(true);
    setAddMsg(null);
    try {
      await axios.post('/api/admin/tournament-sync-configs', {
        tournament_id: Number(addTId),
        season_id: addSId ? Number(addSId) : null,
      });
      setAddTId('');
      setAddSId('');
      setAddMsg({ ok: true, text: 'Tournament added' });
      loadTournamentConfigs();
    } catch (e: any) {
      setAddMsg({ ok: false, text: e.response?.data?.error || 'Failed to add' });
    } finally {
      setAdding(false);
    }
  };

  const handleManualSync = async (cfg: TournamentSyncConfig, scope: 'matches' | 'events' | 'standings') => {
    const key = `${cfg.id}_${scope}`;
    setSyncingId(prev => ({ ...prev, [key]: true }));
    try {
      await axios.post('/api/admin/sync', { scope, tournamentId: cfg.tournament_id, seasonId: cfg.season_id });
      setTimeout(loadSyncData, 3000);
    } finally {
      setSyncingId(prev => ({ ...prev, [key]: false }));
    }
  };

  // ── Quick sync ────────────────────────────────────────────────────────────
  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await axios.post('/api/admin/sync', { scope: syncScope });
      setSyncMsg({ ok: true, text: `${syncScope} sync triggered` });
      setTimeout(loadSyncData, 3000);
    } catch (e: any) {
      setSyncMsg({ ok: false, text: e.response?.data?.error || 'Sync trigger failed' });
    } finally {
      setSyncing(false);
    }
  };

  // ── Clear events ──────────────────────────────────────────────────────────
  const handleClearEvents = async () => {
    if (!clearTournamentId) return;
    setClearing(true);
    setClearMsg(null);
    try {
      const res = await axios.delete('/api/admin/events', {
        data: { tournamentId: Number(clearTournamentId), seasonId: clearSeasonId ? Number(clearSeasonId) : undefined },
      });
      setClearMsg({ ok: true, text: `Cleared scores & cards for ${res.data.matchesCleared} matches` });
    } catch (e: any) {
      setClearMsg({ ok: false, text: e.response?.data?.error || 'Clear failed' });
    } finally {
      setClearing(false);
    }
  };

  // ── Config tab ────────────────────────────────────────────────────────────
  const handleSelectConfig = (item: ConfigItem) => {
    setSelectedConfig(item);
    setEditJson(JSON.stringify(item.config, null, 2));
    setConfigMsg(null);
  };

  const handleSavePflConfig = async () => {
    if (!selectedConfig) return;
    try {
      const parsed = JSON.parse(editJson);
      await axios.put(`/api/admin/configs/${selectedConfig.folder}/${selectedConfig.template}`, parsed);
      setConfigMsg({ ok: true, text: 'Saved successfully' });
      loadConfigs();
    } catch (e: any) {
      setConfigMsg({ ok: false, text: e.response?.data?.error || 'Invalid JSON or save failed' });
    }
  };

  // ── Tour dropdowns tab ────────────────────────────────────────────────────
  const handleSelectTourFolder = (folder: string, data: unknown[] | null) => {
    setSelectedTourFolder(folder);
    setEditTourJson(JSON.stringify(data, null, 2));
    setTourMsg(null);
  };

  const handleSaveTourDropdown = async () => {
    if (!selectedTourFolder) return;
    try {
      const parsed = JSON.parse(editTourJson);
      await axios.put(`/api/admin/tour-dropdowns/${selectedTourFolder}`, parsed);
      setTourMsg({ ok: true, text: 'Saved successfully' });
      loadTourDropdowns();
    } catch (e: any) {
      setTourMsg({ ok: false, text: e.response?.data?.error || 'Invalid JSON or save failed' });
    }
  };

  if (loading) return null;
  if (!user || user.role !== 'admin') return null;

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Admin Panel</h1>
        <button style={s.backBtn} onClick={() => navigate('/')}>← Back to Editor</button>
      </div>

      <div style={s.body}>
        <div style={s.tabs}>
          {(['sync', 'configs', 'status', 'tourDropdowns'] as const).map(tab => (
            <button key={tab} style={s.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>
              {tab === 'sync' ? 'Sync Control' : tab === 'configs' ? 'Template Configs' : tab === 'status' ? 'DB Status' : 'Tour Dropdowns'}
            </button>
          ))}
        </div>

        {/* ── Sync Control ──────────────────────────────────────────────── */}
        {activeTab === 'sync' && (
          <>
            {/* Global auto-sync */}
            <div style={s.card}>
              <label style={s.label}>Global Auto-Sync</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, color: '#374151' }}>Every</span>
                <input
                  type="number" min={1}
                  style={{ ...s.input, maxWidth: 90 }}
                  value={syncInterval}
                  onChange={e => setSyncInterval(e.target.value)}
                />
                <span style={{ fontSize: 13, color: '#374151' }}>minutes</span>
                <button style={s.btn()} onClick={handleSaveSyncSettings}>Save</button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Toggle enabled={globalEnabled} onChange={handleToggleGlobal} />
                  <span style={{ fontSize: 13, color: globalEnabled ? '#059669' : '#9ca3af', fontWeight: 600 }}>
                    {globalEnabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
              {syncMsg && <div style={s.toast(syncMsg.ok)}>{syncMsg.text}</div>}
            </div>

            {/* Quick manual sync (all tournaments) */}
            <div style={s.card}>
              <label style={s.label}>Quick Manual Sync</label>
              <div style={s.row}>
                <select style={{ ...s.input, maxWidth: 160 }} value={syncScope} onChange={e => setSyncScope(e.target.value)}>
                  <option value="full">Full sync</option>
                  <option value="matches">Matches only</option>
                  <option value="events">Events only</option>
                </select>
                <button style={s.btn(syncing ? '#9ca3af' : '#10b981')} onClick={handleSyncNow} disabled={syncing}>
                  {syncing ? 'Triggering…' : 'Sync Now'}
                </button>
                <button style={s.outlineBtn} onClick={loadSyncData}>Refresh</button>
              </div>
            </div>

            {/* Per-tournament sync configs */}
            <div style={s.card}>
              <label style={s.label}>Sync by Tournament</label>
              <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>
                Save tournament entries with individual sync intervals. Each has its own schedule and manual sync buttons.
              </p>

              {tConfigs.length === 0 && (
                <div style={{ color: '#9ca3af', fontSize: 13, marginBottom: 16 }}>No tournaments added yet.</div>
              )}

              {tConfigs.map(cfg => {
                const local = localCfg[cfg.id];
                if (!local) return null;
                const mKey = `${cfg.id}_matches`;
                const eKey = `${cfg.id}_events`;
                const msg = cfgMsgs[cfg.id];
                return (
                  <div key={cfg.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b' }}>
                        Tournament {cfg.tournament_id}{cfg.season_id ? ` / Season ${cfg.season_id}` : ''}
                      </span>
                      <button
                        onClick={() => handleDeleteConfig(cfg.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 18, lineHeight: 1 }}
                        title="Remove"
                      >×</button>
                    </div>

                    {/* Matches row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#374151', width: 60, flexShrink: 0 }}>Matches</span>
                      <span style={{ fontSize: 13, color: '#6b7280' }}>every</span>
                      <input
                        type="number" min={1}
                        style={{ ...s.input, maxWidth: 70, padding: '5px 8px' }}
                        value={local.matches_interval_minutes}
                        onChange={e => patchLocal(cfg.id, { matches_interval_minutes: Number(e.target.value) })}
                      />
                      <span style={{ fontSize: 13, color: '#6b7280' }}>min</span>
                      <Toggle enabled={local.matches_enabled} onChange={() => handleToggleField(cfg, 'matches_enabled')} />
                      <span style={{ fontSize: 12, color: local.matches_enabled ? '#059669' : '#9ca3af', fontWeight: 600 }}>
                        {local.matches_enabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        style={s.smBtn(syncingId[mKey] ? '#9ca3af' : '#3b82f6')}
                        disabled={!!syncingId[mKey]}
                        onClick={() => handleManualSync(cfg, 'matches')}
                      >
                        {syncingId[mKey] ? '…' : 'Sync Matches'}
                      </button>
                    </div>

                    {/* Events row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#374151', width: 60, flexShrink: 0 }}>Events</span>
                      <span style={{ fontSize: 13, color: '#6b7280' }}>every</span>
                      <input
                        type="number" min={1}
                        style={{ ...s.input, maxWidth: 70, padding: '5px 8px' }}
                        value={local.events_interval_minutes}
                        onChange={e => patchLocal(cfg.id, { events_interval_minutes: Number(e.target.value) })}
                      />
                      <span style={{ fontSize: 13, color: '#6b7280' }}>min</span>
                      <Toggle enabled={local.events_enabled} onChange={() => handleToggleField(cfg, 'events_enabled')} />
                      <span style={{ fontSize: 12, color: local.events_enabled ? '#059669' : '#9ca3af', fontWeight: 600 }}>
                        {local.events_enabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        style={s.smBtn(syncingId[eKey] ? '#9ca3af' : '#10b981')}
                        disabled={!!syncingId[eKey]}
                        onClick={() => handleManualSync(cfg, 'events')}
                      >
                        {syncingId[eKey] ? '…' : 'Sync Events'}
                      </button>
                    </div>

                    {/* Standings row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, color: '#374151', width: 60, flexShrink: 0 }}>Standings</span>
                      <span style={{ fontSize: 13, color: '#6b7280' }}>every</span>
                      <input
                        type="number" min={1}
                        style={{ ...s.input, maxWidth: 70, padding: '5px 8px' }}
                        value={local.standings_interval_minutes}
                        onChange={e => patchLocal(cfg.id, { standings_interval_minutes: Number(e.target.value) })}
                      />
                      <span style={{ fontSize: 13, color: '#6b7280' }}>min</span>
                      <Toggle enabled={local.standings_enabled} onChange={() => handleToggleField(cfg, 'standings_enabled')} />
                      <span style={{ fontSize: 12, color: local.standings_enabled ? '#059669' : '#9ca3af', fontWeight: 600 }}>
                        {local.standings_enabled ? 'ON' : 'OFF'}
                      </span>
                      <button
                        style={s.smBtn(syncingId[`${cfg.id}_standings`] ? '#9ca3af' : '#f59e0b')}
                        disabled={!!syncingId[`${cfg.id}_standings`]}
                        onClick={() => handleManualSync(cfg, 'standings')}
                      >
                        {syncingId[`${cfg.id}_standings`] ? '…' : 'Sync Standings'}
                      </button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <button
                        style={s.smBtn(savingId === cfg.id ? '#9ca3af' : '#6366f1')}
                        disabled={savingId === cfg.id}
                        onClick={() => handleSaveConfig(cfg.id)}
                      >
                        {savingId === cfg.id ? 'Saving…' : 'Save Intervals'}
                      </button>
                      {msg?.text && (
                        <span style={{ fontSize: 12, color: msg.ok ? '#166534' : '#991b1b', fontWeight: 600 }}>
                          {msg.text}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add tournament */}
              <div style={{ marginTop: 12, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}>
                <label style={{ ...s.label, marginBottom: 8 }}>Add Tournament</label>
                <div style={s.row}>
                  <input
                    type="number" placeholder="Tournament ID"
                    style={{ ...s.input, maxWidth: 150 }}
                    value={addTId}
                    onChange={e => { setAddTId(e.target.value); setAddMsg(null); }}
                  />
                  <input
                    type="number" placeholder="Season ID (optional)"
                    style={{ ...s.input, maxWidth: 170 }}
                    value={addSId}
                    onChange={e => { setAddSId(e.target.value); setAddMsg(null); }}
                  />
                  <button
                    style={s.btn(!addTId || adding ? '#9ca3af' : '#10b981')}
                    disabled={!addTId || adding}
                    onClick={handleAddConfig}
                  >
                    {adding ? 'Adding…' : '+ Add'}
                  </button>
                </div>
                {addMsg && <div style={s.toast(addMsg.ok)}>{addMsg.text}</div>}
              </div>
            </div>

            {/* Clear events */}
            <div style={s.card}>
              <label style={s.label}>Clear Events</label>
              <p style={{ margin: '0 0 12px', fontSize: 13, color: '#6b7280' }}>
                Resets scores and cards for a tournament so you can re-sync events from scratch.
              </p>
              <div style={s.row}>
                <input
                  type="number" placeholder="Tournament ID"
                  style={{ ...s.input, maxWidth: 150 }}
                  value={clearTournamentId}
                  onChange={e => { setClearTournamentId(e.target.value); setClearMsg(null); }}
                />
                <input
                  type="number" placeholder="Season ID (optional)"
                  style={{ ...s.input, maxWidth: 170 }}
                  value={clearSeasonId}
                  onChange={e => { setClearSeasonId(e.target.value); setClearMsg(null); }}
                />
                <button
                  style={s.btn(!clearTournamentId || clearing ? '#9ca3af' : '#ef4444')}
                  disabled={!clearTournamentId || clearing}
                  onClick={handleClearEvents}
                >
                  {clearing ? 'Clearing…' : 'Clear Events'}
                </button>
              </div>
              {clearMsg && <div style={s.toast(clearMsg.ok)}>{clearMsg.text}</div>}
            </div>

            {/* Sync logs */}
            <div style={s.card}>
              <label style={s.label}>Recent Sync Logs</label>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Type</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Items</th>
                    <th style={s.th}>Started</th>
                    <th style={s.th}>Duration</th>
                    <th style={s.th}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.length === 0 && (
                    <tr><td colSpan={6} style={{ ...s.td, color: '#9ca3af', textAlign: 'center' }}>No sync logs yet</td></tr>
                  )}
                  {syncLogs.map(log => {
                    const duration = log.completed_at
                      ? `${Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)}s`
                      : '—';
                    return (
                      <tr key={log.id}>
                        <td style={s.td}>{log.type}</td>
                        <td style={s.td}><span style={s.badge(log.status)}>{log.status}</span></td>
                        <td style={s.td}>{log.items_synced}</td>
                        <td style={s.td}>{new Date(log.started_at).toLocaleString()}</td>
                        <td style={s.td}>{duration}</td>
                        <td style={{ ...s.td, color: log.status === 'error' ? '#991b1b' : undefined }}>{log.message || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Template Configs ──────────────────────────────────────────── */}
        {activeTab === 'configs' && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ ...s.card, width: 220, flexShrink: 0, padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
              {configs.length === 0 && (
                <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>No configs found</div>
              )}
              {configs.map(item => (
                <button
                  key={`${item.folder}/${item.template}`}
                  onClick={() => handleSelectConfig(item)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                    background: selectedConfig?.folder === item.folder && selectedConfig?.template === item.template ? '#eff6ff' : 'none',
                    border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                    color: '#1e293b', fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{item.folder}</div>
                  <div style={{ color: '#6b7280', fontSize: 12 }}>{item.template}</div>
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              {!selectedConfig ? (
                <div style={{ ...s.card, color: '#9ca3af', textAlign: 'center' }}>
                  Select a config from the left to edit it
                </div>
              ) : (
                <div style={s.card}>
                  <label style={s.label}>{selectedConfig.folder} / {selectedConfig.template}.pfl.json</label>
                  <textarea
                    style={s.textarea}
                    value={editJson}
                    onChange={e => { setEditJson(e.target.value); setConfigMsg(null); }}
                    spellCheck={false}
                  />
                  <div style={{ marginTop: 12 }}>
                    <button style={s.btn()} onClick={handleSavePflConfig}>Save Config</button>
                  </div>
                  {configMsg && <div style={s.toast(configMsg.ok)}>{configMsg.text}</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DB Status ─────────────────────────────────────────────────── */}
        {activeTab === 'status' && (
          <div style={s.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <label style={{ ...s.label, marginBottom: 0 }}>Database Status</label>
              <button style={s.outlineBtn} onClick={loadHealth}>Refresh</button>
            </div>
            {healthError && <div style={s.toast(false)}>{healthError}</div>}
            {health && (
              <>
                <div style={{ marginBottom: 20 }}>
                  <span style={s.badge(health.db === 'connected' ? 'success' : 'error')}>
                    PostgreSQL: {health.db}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[
                    { label: 'Matches', value: health.matches },
                    { label: 'Teams', value: health.teams },
                    { label: 'Sync Logs', value: health.syncLogs },
                  ].map(({ label, value }) => (
                    <div key={label} style={s.statBox}>
                      <div style={s.statNum}>{value.toLocaleString()}</div>
                      <div style={s.statLbl}>{label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Tour Dropdowns ────────────────────────────────────────────── */}
        {activeTab === 'tourDropdowns' && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ ...s.card, width: 160, flexShrink: 0, padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
              {tourDropdowns.length === 0 && (
                <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>No files found</div>
              )}
              {tourDropdowns.map(item => (
                <button
                  key={item.folder}
                  onClick={() => handleSelectTourFolder(item.folder, item.data)}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '10px 16px',
                    background: selectedTourFolder === item.folder ? '#eff6ff' : 'none',
                    border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                    color: item.error ? '#991b1b' : '#1e293b', fontSize: 13, fontWeight: 600,
                  }}
                >
                  {item.folder}
                  {item.error && <div style={{ fontSize: 11, color: '#991b1b' }}>parse error</div>}
                </button>
              ))}
            </div>
            <div style={{ flex: 1 }}>
              {!selectedTourFolder ? (
                <div style={{ ...s.card, color: '#9ca3af', textAlign: 'center' }}>
                  Select a folder from the left to edit its dropdown-tour.json
                </div>
              ) : (
                <div style={s.card}>
                  <label style={s.label}>{selectedTourFolder} / dropdown-tour.json</label>
                  <textarea
                    style={s.textarea}
                    value={editTourJson}
                    onChange={e => { setEditTourJson(e.target.value); setTourMsg(null); }}
                    spellCheck={false}
                  />
                  <div style={{ marginTop: 12 }}>
                    <button style={s.btn()} onClick={handleSaveTourDropdown}>Save</button>
                  </div>
                  {tourMsg && <div style={s.toast(tourMsg.ok)}>{tourMsg.text}</div>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
