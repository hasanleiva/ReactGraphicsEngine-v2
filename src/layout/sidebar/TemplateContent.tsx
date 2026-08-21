import { FC, useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useEditor } from 'canva-editor/hooks';
import { PageSize, SerializedPage, SearchResponse, ImageData } from 'canva-editor/types';
import CloseSidebarButton from './CloseButton';
import TemplateSearchBox from './components/TemplateSearchBox';
import HorizontalCarousel from 'canva-editor/components/carousel/HorizontalCarousel';
import OutlineButton from 'canva-editor/components/button/OutlineButton';
import { unpack, pack, dataMapping } from 'canva-editor/utils/minifier';
import useMobileDetect from 'canva-editor/hooks/useMobileDetect';
import axios from 'axios';
import { useTranslate } from 'canva-editor/contexts/TranslationContext';
import { useAuth } from '../../contexts/AuthContext';

const LoadingOverlay: FC<{ progress: number }> = ({ progress }) => (
  <div
    css={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      zIndex: 10,
      gap: 8,
    }}
  >
    <span css={{ color: '#fff', fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>
      {progress}%
    </span>
    <div css={{ width: '65%', height: 4, background: 'rgba(255,255,255,0.25)', borderRadius: 2 }}>
      <div
        css={{
          height: '100%',
          background: '#fff',
          borderRadius: 2,
          transition: 'width 0.2s ease',
          width: `${progress}%`,
        }}
      />
    </div>
  </div>
);

interface Template {
  img: ImageData;
  data: Array<SerializedPage> | SerializedPage;
  pages: number;
}
const TemplateContent: FC<{ onClose: () => void }> = ({ onClose }) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [r2Templates, setR2Templates] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { actions, activePage, config, query } = useEditor((state, query) => ({
    activePage: state.activePage,
  }));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const dataRef = useRef(false);
  const [keyword, setKeyword] = useState('');
  const isMobile = useMobileDetect();
  const t = useTranslate();
  const { user } = useAuth();
  const [packName, setPackName] = useState('');
  const [selectedPack, setSelectedPack] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [loadingCard, setLoadingCard] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);

  const packs = useMemo(() => {
    const grouped: Record<string, string[]> = { 'Default': [] };
    r2Templates.forEach(id => {
      if (id.includes('/')) {
        const [pack, ...rest] = id.split('/');
        if (!grouped[pack]) grouped[pack] = [];
        grouped[pack].push(id);
      } else {
        grouped['Default'].push(id);
      }
    });
    if (grouped['Default'].length === 0) {
      delete grouped['Default'];
    }
    return grouped;
  }, [r2Templates]);

  const handleSaveToPack = async () => {
    if (!packName) return alert('Please enter a pack name');
    try {
      const content = pack(query.serialize(), dataMapping)[0];
      const templateName = prompt('Enter template name:', `template_${Date.now()}`);
      if (!templateName) return;
      
      setIsSaving(true);
      const id = `${packName}/${templateName}`;
      await axios.post('/api/templates/save', { id, content });
      alert('Saved successfully!');
      loadR2Templates();
    } catch (err) {
      console.error(err);
      alert('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const loadR2Templates = async () => {
    try {
      const res = await axios.get('/api/templates/list');
      if (res.data.success) {
        setR2Templates(res.data.templates);
      }
    } catch (err) {
      console.error('Failed to load R2 templates', err);
    }
  };

  const loadData = useCallback(
    async (offset = 0, kw = '') => {
      dataRef.current = true;
      setIsLoading(true);
      try {
        const res = await axios.get<SearchResponse<Template>>(
          `${config.apis.url}${config.apis.searchTemplates}?ps=18&pi=${offset}&kw=${kw}`
        );

        if (res.data.data) {
          setTemplates((templates) => [...templates, ...res.data.data]);
        }
        if (res.data.data?.length > 0) {
          dataRef.current = false;
        }
      } catch (err) {
        console.error(err);
      }
      setIsLoading(false);
    },
    [setIsLoading]
  );

  useEffect(() => {
    loadData(offset, keyword);
    if (offset === 0) {
      loadR2Templates();
    }
  }, [offset, keyword]);

  useEffect(() => {
    const handler = () => loadR2Templates();
    window.addEventListener('canvaTemplateDeleted', handler);
    return () => window.removeEventListener('canvaTemplateDeleted', handler);
  }, []);

  useEffect(() => {
    const handleLoadMore = async (e: Event) => {
      const node = e.target as HTMLDivElement;
      if (
        node.scrollHeight - node.scrollTop - 80 <= node.clientHeight &&
        !dataRef.current
      ) {
        setOffset((prevOffset) => prevOffset + 1);
      }
    };

    scrollRef.current?.addEventListener('scroll', handleLoadMore);
    return () => {
      scrollRef.current?.removeEventListener('scroll', handleLoadMore);
    };
  }, [loadData]);

  const handleSearch = async (kw: string) => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
    setOffset(0);
    setKeyword(kw);
    setTemplates([]);
  };

  const addPages = async (data: Array<SerializedPage> | SerializedPage) => {
    try {
      const unpackedData = unpack(data);
      const pages = Array.isArray(unpackedData) ? unpackedData : [unpackedData];
      actions.setData(pages);
      // Reset zoom to fit after template is applied
      window.dispatchEvent(new CustomEvent('canvaResetZoom'));
    } catch (err) {
      console.warn('Something went wrong!');
      console.log(err);
    }
    if (isMobile) {
      onClose();
    } else if (user?.role === 'user') {
      actions.setSidebarTab('Elements');
    }
  };

  const handleSearchTemplateClick = async (item: Template, key: string) => {
    setLoadingCard(key);
    setLoadingProgress(20);
    // unpack + setData is synchronous; give the browser a tick to render the overlay
    await new Promise((r) => setTimeout(r, 16));
    setLoadingProgress(70);
    await addPages(item.data);
    setLoadingProgress(100);
    setTimeout(() => { setLoadingCard(null); setLoadingProgress(0); }, 350);
  };

  const loadR2Template = async (id: string) => {
    setLoadingCard(id);
    setLoadingProgress(0);
    try {
      setIsLoading(true);
      const res = await axios.get(`/api/templates/get/${id}`, {
        onDownloadProgress: (e) => {
          if (e.total) {
            setLoadingProgress(Math.round((e.loaded / e.total) * 85));
          } else {
            setLoadingProgress((prev) => Math.min(prev + 12, 80));
          }
        },
      });
      if (res.data.success) {
        setLoadingProgress(90);
        await addPages(res.data.content);
        setLoadingProgress(100);
        window.dispatchEvent(new CustomEvent('canvaTemplateLoaded', { detail: { id } }));
      } else {
        alert('Failed to load template');
      }
    } catch (err) {
      console.error('Failed to load template', err);
      alert('Failed to load template');
    } finally {
      setIsLoading(false);
      setTimeout(() => { setLoadingCard(null); setLoadingProgress(0); }, 350);
    }
  };

  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        flexDirection: 'column',
        display: 'flex',
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      {!isMobile && <CloseSidebarButton onClose={onClose} />}
      
      {user?.role === 'admin' && (
        <div css={{ marginBottom: 16, display: 'flex', gap: 8, flexDirection: 'column', flexShrink: 0 }}>
          <div css={{ fontSize: 14, fontWeight: 600 }}>Admin: Save to Pack</div>
          <input 
            type="text" 
            placeholder="Pack Name" 
            value={packName}
            onChange={(e) => setPackName(e.target.value)}
            css={{
              padding: '8px 12px',
              border: '1px solid #ccc',
              borderRadius: 4,
              fontSize: 14
            }}
          />
          <button 
            onClick={handleSaveToPack}
            disabled={isSaving}
            css={{
              padding: '8px 12px',
              background: isSaving ? '#8383A2' : '#3a3a4c',
              color: '#fff',
              borderRadius: 4,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontWeight: 600
            }}
          >
            {isSaving ? 'Saving...' : 'Save Current Design to Pack'}
          </button>
        </div>
      )}

      <div
        ref={scrollRef}
        css={{ 
          flexDirection: 'column', 
          overflowY: 'auto', 
          overflowX: 'hidden',
          display: 'flex',
          flexGrow: 1
        }}
      >
        <div
          css={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2,minmax(0,1fr))',
            gridGap: 8,
            padding: 4, // Add a little padding so hover scale doesn't clip
          }}
        >
          {!selectedPack ? (
            <>
              {(() => {
                const PACK_ORDER = ['UZSL', 'PRO', '1-LIGA', 'U21', 'U19'];
                return Object.keys(packs)
                  .sort((a, b) => {
                    const ai = PACK_ORDER.indexOf(a);
                    const bi = PACK_ORDER.indexOf(b);
                    if (ai === -1 && bi === -1) return a.localeCompare(b);
                    if (ai === -1) return 1;
                    if (bi === -1) return -1;
                    return ai - bi;
                  });
              })().map((packName) => (
                <div
                  key={packName}
                  css={{
                    cursor: 'pointer',
                    padding: 0,
                    background: '#e0e0e0',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    minHeight: '100px',
                    overflow: 'hidden',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                    transition: 'transform 0.2s',
                    ':hover': {
                      transform: 'scale(1.02)'
                    }
                  }}
                  onClick={() => setSelectedPack(packName)}
                >
                  <img
                    src={`/pack_logos/${packName.toLowerCase()}_logo.png`}
                    alt={packName}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                    onError={e => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      (e.currentTarget.nextSibling as HTMLElement).style.display = 'block';
                    }}
                  />
                  <span style={{ display: 'none', fontWeight: 'bold' }}>{packName} ({packs[packName].length})</span>
                </div>
              ))}
              {templates.map((item, index) => {
                const cardKey = `template-${index}`;
                const isCardLoading = loadingCard === cardKey;
                return (
                  <div
                    key={index}
                    css={{ cursor: 'pointer', position: 'relative' }}
                    onClick={() => !loadingCard && handleSearchTemplateClick(item, cardKey)}
                  >
                    {!!item?.img && <img src={item?.img?.url} width={item?.img?.width} height={item?.img?.height} loading='lazy' />}
                    {item.pages > 1 && (
                      <span
                        css={{
                          position: 'absolute',
                          bottom: 5,
                          right: 5,
                          backgroundColor: 'rgba(17,23,29,.6)',
                          padding: '1px 6px',
                          borderRadius: 6,
                          color: '#fff',
                          fontSize: 10,
                        }}
                      >
                        {item.pages}
                      </span>
                    )}
                    {isCardLoading && <LoadingOverlay progress={loadingProgress} />}
                  </div>
                );
              })}
            </>
          ) : (
            <>
              <div 
                css={{ 
                  gridColumn: '1 / -1', 
                  cursor: 'pointer', 
                  padding: '12px', 
                  background: '#3a3a4c', 
                  color: '#fff',
                  borderRadius: 4, 
                  textAlign: 'center', 
                  fontWeight: 'bold',
                  marginBottom: '8px',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  transition: 'background 0.2s',
                  ':hover': {
                    background: '#2a2a3c'
                  }
                }}
                onClick={() => setSelectedPack(null)}
              >
                ← Back to Packs
              </div>
              {packs[selectedPack]?.map((id) => {
                const isCardLoading = loadingCard === id;
                return (
                  <div
                    key={id}
                    css={{
                      cursor: 'pointer',
                      padding: '16px',
                      background: '#f0f0f0',
                      borderRadius: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      textAlign: 'center',
                      wordBreak: 'break-all',
                      minHeight: '100px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                      transition: 'transform 0.2s',
                      position: 'relative',
                      overflow: 'hidden',
                      ':hover': {
                        transform: isCardLoading ? 'none' : 'scale(1.02)',
                      },
                    }}
                    onClick={() => !loadingCard && loadR2Template(id)}
                  >
                    {id.split('/').pop()}
                    {isCardLoading && <LoadingOverlay progress={loadingProgress} />}
                  </div>
                );
              })}
            </>
          )}
          {isLoading && !selectedPack && <div>{t('common.loading', 'Loading...')}</div>}
        </div>
      </div>
    </div>
  );
};

export default TemplateContent;
