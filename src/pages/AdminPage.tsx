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

interface SyncSettings {
  sync_interval_minutes: string;
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

const styles = {
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
  outlineBtn: { background: 'none', border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14, color: '#374151' } as React.CSSProperties,
  badge: (status: string): React.CSSProperties => ({
    display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
    background: status === 'success' ? '#dcfce7' : status === 'error' ? '#fee2e2' : status === 'running' ? '#dbeafe' : '#f3f4f6',
    color: status === 'success' ? '#166534' : status === 'error' ? '#991b1b' : status === 'running' ? '#1d4ed8' : '#374151',
  }),
  row: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const, marginBottom: 16 } as React.CSSProperties,
  toast: (ok: boolean): React.CSSProperties => ({
    padding: '8px 14px', borderRadius: 6, fontSize: 13, marginTop: 8,
    background: ok ? '#dcfce7' : '#fee2e2',
    color: ok ? '#166534' : '#991b1b',
  }),
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 13 } as React.CSSProperties,
  th: { textAlign: 'left' as const, padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 600, color: '#374151' } as React.CSSProperties,
  td: { padding: '8px 12px', borderBottom: '1px solid #f1f5f9', color: '#4b5563' } as React.CSSProperties,
  statBox: { textAlign: 'center' as const, padding: '16px 24px', background: '#f8fafc', borderRadius: 8, flex: '1' },
  statNum: { fontSize: 28, fontWeight: 700, color: '#1e293b' } as React.CSSProperties,
  statLbl: { fontSize: 12, color: '#6b7280', marginTop: 4 } as React.CSSProperties,
};

export default function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'configs' | 'sync' | 'status'>('sync');

  // Config state
  const [configs, setConfigs] = useState<ConfigItem[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<ConfigItem | null>(null);
  const [editJson, setEditJson] = useState('');
  const [configMsg, setConfigMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Sync state
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [syncInterval, setSyncInterval] = useState('60');
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [syncScope, setSyncScope] = useState('full');
  const [syncMsg, setSyncMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Status state
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthError, setHealthError] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  const loadConfigs = useCallback(async () => {
    try {
      const res = await axios.get('/api/admin/configs');
      setConfigs(res.data);
    } catch { /* ignore */ }
  }, []);

  const loadSyncData = useCallback(async () => {
    try {
      const [settingsRes, logsRes] = await Promise.all([
        axios.get('/api/admin/sync/settings'),
        axios.get('/api/admin/sync/logs'),
      ]);
      setSyncSettings(settingsRes.data);
      setSyncInterval(settingsRes.data.sync_interval_minutes || '60');
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

  useEffect(() => {
    if (activeTab === 'configs') loadConfigs();
    if (activeTab === 'sync') loadSyncData();
    if (activeTab === 'status') loadHealth();
  }, [activeTab, loadConfigs, loadSyncData, loadHealth]);

  const handleSelectConfig = (item: ConfigItem) => {
    setSelectedConfig(item);
    setEditJson(JSON.stringify(item.config, null, 2));
    setConfigMsg(null);
  };

  const handleSaveConfig = async () => {
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

  const handleSaveInterval = async () => {
    try {
      await axios.put('/api/admin/sync/settings', { sync_interval_minutes: parseInt(syncInterval, 10) });
      setSyncMsg({ ok: true, text: `Interval updated to ${syncInterval} min` });
      loadSyncData();
    } catch (e: any) {
      setSyncMsg({ ok: false, text: e.response?.data?.error || 'Failed to update interval' });
    }
  };

  const handleSyncNow = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      await axios.post('/api/admin/sync', { scope: syncScope });
      setSyncMsg({ ok: true, text: `${syncScope} sync triggered — check logs below` });
      setTimeout(loadSyncData, 3000);
    } catch (e: any) {
      setSyncMsg({ ok: false, text: e.response?.data?.error || 'Sync trigger failed' });
    } finally {
      setSyncing(false);
    }
  };

  if (loading) return null;
  if (!user || user.role !== 'admin') return null;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Admin Panel</h1>
        <button style={styles.backBtn} onClick={() => navigate('/')}>← Back to Editor</button>
      </div>

      <div style={styles.body}>
        <div style={styles.tabs}>
          {(['sync', 'configs', 'status'] as const).map(tab => (
            <button key={tab} style={styles.tab(activeTab === tab)} onClick={() => setActiveTab(tab)}>
              {tab === 'sync' ? 'Sync Control' : tab === 'configs' ? 'Template Configs' : 'DB Status'}
            </button>
          ))}
        </div>

        {/* ── Sync Control ──────────────────────────────────────────── */}
        {activeTab === 'sync' && (
          <>
            <div style={styles.card}>
              <label style={styles.label}>Sync Interval (minutes)</label>
              <div style={styles.row}>
                <input
                  type="number"
                  min={1}
                  style={{ ...styles.input, maxWidth: 120 }}
                  value={syncInterval}
                  onChange={e => setSyncInterval(e.target.value)}
                />
                <button style={styles.btn()} onClick={handleSaveInterval}>Save Interval</button>
              </div>

              <label style={styles.label}>Manual Sync</label>
              <div style={styles.row}>
                <select
                  style={{ ...styles.input, maxWidth: 160 }}
                  value={syncScope}
                  onChange={e => setSyncScope(e.target.value)}
                >
                  <option value="full">Full sync</option>
                  <option value="matches">Matches only</option>
                  <option value="events">Events only</option>
                </select>
                <button
                  style={styles.btn(syncing ? '#9ca3af' : '#10b981')}
                  onClick={handleSyncNow}
                  disabled={syncing}
                >
                  {syncing ? 'Triggering…' : 'Sync Now'}
                </button>
                <button style={styles.outlineBtn} onClick={loadSyncData}>Refresh</button>
              </div>
              {syncMsg && <div style={styles.toast(syncMsg.ok)}>{syncMsg.text}</div>}
            </div>

            <div style={styles.card}>
              <label style={styles.label}>Recent Sync Logs</label>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Type</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Items</th>
                    <th style={styles.th}>Started</th>
                    <th style={styles.th}>Duration</th>
                    <th style={styles.th}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.length === 0 && (
                    <tr><td colSpan={6} style={{ ...styles.td, color: '#9ca3af', textAlign: 'center' }}>No sync logs yet</td></tr>
                  )}
                  {syncLogs.map(log => {
                    const duration = log.completed_at
                      ? `${Math.round((new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()) / 1000)}s`
                      : '—';
                    return (
                      <tr key={log.id}>
                        <td style={styles.td}>{log.type}</td>
                        <td style={styles.td}><span style={styles.badge(log.status)}>{log.status}</span></td>
                        <td style={styles.td}>{log.items_synced}</td>
                        <td style={styles.td}>{new Date(log.started_at).toLocaleString()}</td>
                        <td style={styles.td}>{duration}</td>
                        <td style={{ ...styles.td, color: log.status === 'error' ? '#991b1b' : undefined }}>{log.message || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ── Template Configs ──────────────────────────────────────── */}
        {activeTab === 'configs' && (
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ ...styles.card, width: 220, flexShrink: 0, padding: 0, overflow: 'hidden', alignSelf: 'flex-start' }}>
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
                <div style={{ ...styles.card, color: '#9ca3af', textAlign: 'center' }}>
                  Select a config from the left to edit it
                </div>
              ) : (
                <div style={styles.card}>
                  <label style={styles.label}>{selectedConfig.folder} / {selectedConfig.template}.pfl.json</label>
                  <textarea
                    style={styles.textarea}
                    value={editJson}
                    onChange={e => { setEditJson(e.target.value); setConfigMsg(null); }}
                    spellCheck={false}
                  />
                  <div style={{ marginTop: 12 }}>
                    <button style={styles.btn()} onClick={handleSaveConfig}>Save Config</button>
                  </div>
                  {configMsg && <div style={styles.toast(configMsg.ok)}>{configMsg.text}</div>}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DB Status ─────────────────────────────────────────────── */}
        {activeTab === 'status' && (
          <div style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <label style={{ ...styles.label, marginBottom: 0 }}>Database Status</label>
              <button style={styles.outlineBtn} onClick={loadHealth}>Refresh</button>
            </div>

            {healthError && <div style={styles.toast(false)}>{healthError}</div>}

            {health && (
              <>
                <div style={{ marginBottom: 20 }}>
                  <span style={styles.badge(health.db === 'connected' ? 'success' : 'error')}>
                    PostgreSQL: {health.db}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {[
                    { label: 'Matches', value: health.matches },
                    { label: 'Teams', value: health.teams },
                    { label: 'Sync Logs', value: health.syncLogs },
                  ].map(({ label, value }) => (
                    <div key={label} style={styles.statBox}>
                      <div style={styles.statNum}>{value.toLocaleString()}</div>
                      <div style={styles.statLbl}>{label}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
