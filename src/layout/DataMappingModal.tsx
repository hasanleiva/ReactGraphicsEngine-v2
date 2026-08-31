'use client';

import React, { FC, useEffect, useState, useCallback } from 'react';
import { useEditor } from 'canva-editor/hooks';
import axios from 'axios';

// ─── Helpers (mirrors ElementsContent.tsx) ───────────────────────────────────

const updateTextInHtml = (html: string, newText: string): string => {
  if (!html) return newText;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const firstSpan = doc.body.querySelector('span');
  if (!firstSpan) {
    doc.body.innerHTML = '';
    newText.split('\n').forEach((line, i, arr) => {
      doc.body.appendChild(doc.createTextNode(line));
      if (i < arr.length - 1) doc.body.appendChild(doc.createElement('br'));
    });
    return doc.body.innerHTML;
  }
  let blockParent = firstSpan.parentElement;
  while (blockParent && blockParent !== doc.body && blockParent.tagName !== 'P' && blockParent.tagName !== 'DIV') {
    blockParent = blockParent.parentElement;
  }
  if (!blockParent || blockParent === doc.body) {
    doc.body.innerHTML = '';
    newText.split('\n').forEach((line, i, arr) => {
      const s = firstSpan.cloneNode(false) as HTMLElement;
      s.textContent = line;
      doc.body.appendChild(s);
      if (i < arr.length - 1) doc.body.appendChild(doc.createElement('br'));
    });
    return doc.body.innerHTML;
  }
  const container = blockParent.parentElement || doc.body;
  container.innerHTML = '';
  newText.split('\n').forEach(line => {
    const block = blockParent!.cloneNode(true) as HTMLElement;
    const s = block.querySelector('span');
    if (s) {
      s.textContent = line;
      Array.from(block.querySelectorAll('span')).forEach(x => { if (x !== s) x.remove(); });
      Array.from(block.querySelectorAll('br')).forEach(b => b.remove());
    }
    container.appendChild(block);
  });
  return doc.body.innerHTML;
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface PflConfig {
  tournamentId: number;
  seasonId?: number | null;
  templateType?: 'fixtures' | 'standings' | 'fulltime';
  matchCount?: number;
  dropdownFile?: string;
  groupId?: number | null;
}

interface DropdownItem {
  id: string;
  text: string;
  logo: string;
}

type Status = { type: 'idle' | 'loading' | 'success' | 'error'; msg: string };

// ─── Modal ────────────────────────────────────────────────────────────────────

interface Props {
  templateId: string;
  onClose: () => void;
}

const DataMappingModal: FC<Props> = ({ templateId, onClose }) => {
  const { layers, actions, activePage } = useEditor((state) => ({
    layers: state.pages[state.activePage]?.layers,
    activePage: state.activePage,
  }));

  const [config, setConfig] = useState<PflConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [dropdownData, setDropdownData] = useState<DropdownItem[]>([]);
  const [tourOptions, setTourOptions] = useState<Array<{ id: number; title: string }>>([]);
  const [tourId, setTourId] = useState('');
  const [matchId, setMatchId] = useState('');
  const [status, setStatus] = useState<Status>({ type: 'idle', msg: '' });

  const folder = templateId.split('/')[0];
  const templateName = templateId.split('/').slice(1).join('/').toUpperCase();

  const detectedType: PflConfig['templateType'] = templateName.includes('STANDINGS')
    ? 'standings'
    : templateName.includes('FULL') || templateName.includes('FULLTIME')
    ? 'fulltime'
    : 'fixtures';

  const activeType = config?.templateType || detectedType;

  // Load config — encode each path segment separately to preserve the slash
  const encodedTemplateId = templateId.split('/').map(s => encodeURIComponent(s)).join('/');

  useEffect(() => {
    setConfig(null);
    setConfigError(null);
    axios.get(`/api/pfl/config/${encodedTemplateId}`)
      .then(res => setConfig(res.data))
      .catch(err => {
        const serverMsg = err.response?.data?.error;
        if (err.response?.status === 404) {
          setConfigError(serverMsg || `No config found for this template.\nCreate: uploads/templates/${templateId}.pfl.json`);
        } else {
          setConfigError(serverMsg || 'Failed to load PFL config');
        }
      });
  }, [encodedTemplateId]);

  // Load dropdown data
  useEffect(() => {
    if (!config?.dropdownFile) return;
    axios.get(`/dropdown-data/${config.dropdownFile}`)
      .then(res => setDropdownData(res.data))
      .catch(() => setDropdownData([]));
  }, [config?.dropdownFile]);

  // Load tour options from folder's dropdown-tour.json
  useEffect(() => {
    setTourId('');
    setTourOptions([]);
    axios.get(`/api/pfl/tours/${encodeURIComponent(folder)}`)
      .then(res => {
        const opts: Array<{ id: number; title: string }> = Array.isArray(res.data) ? res.data : [];
        setTourOptions(opts);
        if (opts.length > 0) setTourId(String(opts[0].id));
      })
      .catch(() => setTourOptions([]));
  }, [folder]);

  // ── Layer helpers ────────────────────────────────────────────────────────────

  const setTextLayer = useCallback((name: string, text: string) => {
    if (!layers) return;
    const layer = Object.values(layers).find(l =>
      (l.data.props.name || (l.data.props as any).a) === name
    );
    if (!layer) return;
    const current = layer.data.props.text || (layer.data.props as any).v || '';
    const isMinified = (layer.data.props as any).v !== undefined && layer.data.props.text === undefined;
    actions.setProp(activePage, layer.id, { [isMinified ? 'v' : 'text']: updateTextInHtml(current, text) });
  }, [layers, actions, activePage]);

  const setDropdownByClubId = useCallback((layerBaseName: string, clubId: number | string | undefined) => {
    if (!layers || clubId === undefined || clubId === null) return;
    const matched = dropdownData.find(item => item.id === String(clubId));
    if (!matched) return;
    const groupLayers = Object.values(layers).filter(l => {
      const et = l.data.props.elementType || (l.data.props as any).aq;
      const nm = l.data.props.name || (l.data.props as any).a;
      return et === 'dropdown' && nm === layerBaseName;
    });
    groupLayers.forEach(layer => {
      if (layer.data.type === 'Text') {
        const current = layer.data.props.text || (layer.data.props as any).v || '';
        const isMinified = (layer.data.props as any).v !== undefined && layer.data.props.text === undefined;
        actions.setProp(activePage, layer.id, { [isMinified ? 'v' : 'text']: updateTextInHtml(current, matched.text) });
      } else if (layer.data.type === 'Image') {
        const isMinified = (layer.data.props as any).p !== undefined && layer.data.props.image === undefined;
        const propName = isMinified ? 'p' : 'image';
        const cur = (layer.data.props as any)[propName] || {};
        actions.setProp(activePage, layer.id, { [propName]: { ...cur, url: matched.logo, thumb: matched.logo } });
      }
    });
  }, [layers, actions, activePage, dropdownData]);

  // ── Mapping logic ────────────────────────────────────────────────────────────

  const applyFixtures = async () => {
    if (!config || !tourId.trim()) return;
    const tourIdNum = Number(tourId.trim());
    const matchCount = config.matchCount || 8;

    // Fetch matches from local DB — scores already computed from sync
    const res = await axios.get('/api/mc/matches', {
      params: {
        tournamentId: config.tournamentId,
        seasonId: config.seasonId || undefined,
        tourId: tourIdNum,
        groupId: config.groupId || undefined,
        limit: matchCount,
        page: 1,
      },
    });
    const matches: any[] = (res.data?.data || []).slice(0, matchCount);

    const UZ_MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentyabr','oktyabr','noyabr','dekabr'];

    actions.history.new();
    matches.forEach((match: any, i: number) => {
      const n = i + 1;
      const homeId = match.home_team_pfl_id;
      const awayId = match.away_team_pfl_id;

      setDropdownByClubId(`Home${n}`, homeId);
      setDropdownByClubId(`Away${n}`, awayId);

      const matchPlayed = match.home_score !== null && match.away_score !== null;

      if (matchPlayed) {
        setTextLayer(`Date${n}`, '');
        setTextLayer(`Time${n}`, '');
        setTextLayer(`Score${n}`, `${match.home_score}:${match.away_score}`);
      } else {
        const rawDate = match.start_date;
        if (rawDate) {
          const dt = new Date(rawDate);
          const d = `${dt.getDate()}-${UZ_MONTHS[dt.getMonth()]}`;
          const t = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
          setTextLayer(`Date${n}`, d);
          setTextLayer(`Time${n}`, t);
        }
        setTextLayer(`Score${n}`, '');
      }
    });

    const tourTitle = matches[0]?.stage_name || String(tourIdNum);
    setTextLayer('TUR', tourTitle);
    setTextLayer('Tur', tourTitle);
  };

  const applyStandings = async () => {
    if (!config) return;
    const res = await axios.get(`/api/pfl/standings/${config.tournamentId}`, {
      params: {
        seasonId: config.seasonId || undefined,
        groupId: config.groupId || undefined,
      },
    });
    const standings: any[] = res.data?.data || res.data?.standings || res.data || [];
    actions.history.new();
    standings.forEach((entry: any, i: number) => {
      const n = i + 1;
      const clubId = entry.club?.id ?? entry.team?.id ?? entry.clubId ?? entry.teamId;
      setDropdownByClubId(`Team-${n}`, clubId);
      const pts = entry.points ?? entry.pts ?? entry.point ?? '';
      const gf = entry.goalsFor ?? entry.gf ?? entry.scored ?? entry.goals_for ?? '';
      const ga = entry.goalsAgainst ?? entry.ga ?? entry.conceded ?? entry.goals_against ?? '';
      const gp = entry.played ?? entry.gp ?? entry.matchesPlayed ?? entry.games ?? '';
      if (pts !== '') setTextLayer(`${n}-OCHKO`, String(pts));
      if (gf !== '' || ga !== '') setTextLayer(`${n}-GF`, `${gf}-${ga}`);
      if (gp !== '') setTextLayer(`${n}-O'YIN`, String(gp));
    });

    const maxPlayed = standings.reduce((max, entry) => {
      const gp = entry.played ?? entry.gp ?? entry.matchesPlayed ?? entry.games ?? 0;
      return Number(gp) > max ? Number(gp) : max;
    }, 0);
    if (maxPlayed > 0) {
      setTextLayer('TUR', `${maxPlayed}-tur`);
      setTextLayer('Tur', `${maxPlayed}-tur`);
    }
  };

  const applyFulltime = async () => {
    if (!matchId.trim()) return;
    const res = await axios.get(`/api/mc/matches/${matchId.trim()}`);
    const match: any = res.data;
    actions.history.new();
    const homeId = match.home_team_pfl_id;
    const awayId = match.away_team_pfl_id;
    // PRO template names
    setDropdownByClubId('HOMECLUB', homeId);
    setDropdownByClubId('AWAYCLUB', awayId);
    // UZSL template names
    setDropdownByClubId('HomeTeam', homeId);
    setDropdownByClubId('AwayTeam', awayId);
    const sh = match.home_score ?? '';
    const sa = match.away_score ?? '';
    setTextLayer('HOMEGOALS', String(sh));
    setTextLayer('AWAYGOALS', String(sa));
    setTextLayer('HomeScores', String(sh));
    setTextLayer('AwayScores', String(sa));
    if (sh !== '' && sa !== '') setTextLayer('SCORE', `${sh} - ${sa}`);
  };

  const handleLoad = async () => {
    if (!config) return;
    setStatus({ type: 'loading', msg: 'Loading data from local database...' });
    try {
      if (activeType === 'standings') await applyStandings();
      else if (activeType === 'fulltime') await applyFulltime();
      else await applyFixtures();
      setStatus({ type: 'success', msg: 'Data applied successfully!' });
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || 'Unknown error';
      setStatus({ type: 'error', msg });
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  const loadDisabled =
    status.type === 'loading' ||
    !config ||
    (activeType === 'fixtures' && !tourId.trim()) ||
    (activeType === 'fulltime' && !matchId.trim());

  return (
    <div
      css={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.55)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        css={{
          background: '#fff', borderRadius: 12, padding: 28, width: 380,
          maxWidth: '95vw', boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Header */}
        <div css={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
          <h2 css={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827', flexGrow: 1 }}>
            Data Mapping
          </h2>
          <button
            onClick={onClose}
            css={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#6b7280', lineHeight: 1, padding: 4, '&:hover': { color: '#111' } }}
          >
            ×
          </button>
        </div>

        {/* Template info */}
        <div css={{ marginBottom: 16, padding: '8px 12px', background: '#f3f4f6', borderRadius: 6, fontSize: 13, color: '#374151' }}>
          <span css={{ fontWeight: 600 }}>Template:</span> {templateId}
          <br />
          <span css={{ fontWeight: 600 }}>Folder:</span> {folder}
          &nbsp;·&nbsp;
          <span css={{ fontWeight: 600 }}>Type:</span>{' '}
          <span css={{ textTransform: 'capitalize' }}>{activeType}</span>
        </div>

        {/* Config error */}
        {configError && (
          <div css={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 12px', fontSize: 13, color: '#991b1b', whiteSpace: 'pre-line', marginBottom: 16 }}>
            {configError}
          </div>
        )}

        {/* Config loaded — show form */}
        {config && (
          <div css={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {activeType === 'fixtures' && (
              <div css={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label css={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Tour
                </label>
                {tourOptions.length > 0 ? (
                  <select
                    value={tourId}
                    onChange={e => setTourId(e.target.value)}
                    css={{
                      padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
                      fontSize: 14, outline: 'none', color: '#111827', background: '#f9fafb',
                      cursor: 'pointer',
                      '&:focus': { borderColor: '#3b82f6', background: '#fff' },
                    }}
                  >
                    {tourOptions.map(t => (
                      <option key={t.id} value={String(t.id)}>{t.title}</option>
                    ))}
                  </select>
                ) : (
                  <span css={{ fontSize: 12, color: '#9ca3af', padding: '8px 12px', border: '1px dashed #d1d5db', borderRadius: 6 }}>
                    No tours configured — add dropdown-tour.json to uploads/templates/{folder}/
                  </span>
                )}
              </div>
            )}

            {activeType === 'fulltime' && (
              <div css={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label css={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Match ID
                </label>
                <input
                  type="text"
                  placeholder="Enter PFL match ID"
                  value={matchId}
                  onChange={e => setMatchId(e.target.value)}
                  css={{
                    padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6,
                    fontSize: 14, outline: 'none', color: '#111827', background: '#f9fafb',
                    '&:focus': { borderColor: '#3b82f6', background: '#fff' },
                  }}
                />
              </div>
            )}

            {activeType === 'standings' && (
              <p css={{ margin: 0, fontSize: 13, color: '#6b7280' }}>
                Click Load to fetch current standings for tournament #{config.tournamentId}.
              </p>
            )}

            <button
              onClick={handleLoad}
              disabled={loadDisabled}
              css={{
                marginTop: 4, padding: '10px 0', borderRadius: 6, border: 'none',
                background: loadDisabled ? '#e5e7eb' : '#2563eb',
                color: loadDisabled ? '#9ca3af' : '#fff',
                fontWeight: 700, fontSize: 14, cursor: loadDisabled ? 'not-allowed' : 'pointer',
                transition: 'background 0.2s',
                '&:hover': !loadDisabled ? { background: '#1d4ed8' } : {},
              }}
            >
              {status.type === 'loading' ? 'Loading...' : 'Load Data'}
            </button>
          </div>
        )}

        {/* Status message */}
        {status.msg && (
          <div css={{
            marginTop: 12, padding: '10px 12px', borderRadius: 6, fontSize: 13,
            background: status.type === 'success' ? '#f0fdf4' : status.type === 'error' ? '#fef2f2' : '#eff6ff',
            color: status.type === 'success' ? '#166534' : status.type === 'error' ? '#991b1b' : '#1e40af',
            border: `1px solid ${status.type === 'success' ? '#86efac' : status.type === 'error' ? '#fca5a5' : '#bfdbfe'}`,
          }}>
            {status.msg}
          </div>
        )}
      </div>
    </div>
  );
};

export default DataMappingModal;
