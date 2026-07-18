'use client';

import {
  forwardRef,
  ForwardRefRenderFunction,
  useState,
  useRef,
  useEffect,
} from 'react';
import { useEditor } from 'canva-editor/hooks';
import EditInlineInput from 'canva-editor/components/EditInlineInput';
import SettingDivider from 'canva-editor/utils/settings/components/SettingDivider';
import EditorButton from 'canva-editor/components/EditorButton';
import NextIcon from 'canva-editor/icons/NextIcon';
import BackIcon from 'canva-editor/icons/BackIcon';
import SyncedIcon from 'canva-editor/icons/SyncedIcon';
import HeaderFileMenu from './sidebar/components/HeaderFileMenu';
import SyncingIcon from 'canva-editor/icons/SyncingIcon';
import useMobileDetect from 'canva-editor/hooks/useMobileDetect';
import styled from '@emotion/styled';
import ExportIcon from 'canva-editor/icons/ExportIcon';
import { useTranslate } from 'canva-editor/contexts/TranslationContext';
import { useAuth } from '../contexts/AuthContext';
import axios from 'axios';
import { dataMapping, pack } from 'canva-editor/utils/minifier';
import DataMappingModal from './DataMappingModal';

const Button = styled('button')`
  display: flex;
  align-items: center;
  color: #fff;
  line-height: 1;
  background: rgb(255 255 255 / 7%);
  padding: 8px;
  border-radius: 4px;
  cursor: pointer;
  &:hover {
    background: rgb(255 255 255 / 15%);
  }
`;

const ProfileMenu = styled.div`
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 8px;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  min-width: 150px;
  overflow: hidden;
  z-index: 1000;
`;

const MenuItem = styled.button`
  padding: 12px 16px;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-size: 14px;
  color: #333;
  &:hover {
    background: #f5f5f5;
  }
`;

interface HeaderLayoutProps {
  logoUrl?: string;
  logoComponent?: React.ReactNode;
  designName: string;
  saving: boolean;
  onChanges: (str: string) => void;
  onRemove: () => void;
}

const HeaderLayout: ForwardRefRenderFunction<
  HTMLDivElement,
  HeaderLayoutProps
> = ({ logoUrl, logoComponent, designName, saving, onChanges, onRemove }, ref) => {
  const [name, setName] = useState(designName);
  const { actions, query } = useEditor();
  const isMobile = useMobileDetect();
  const t = useTranslate();
  const { user, setShowAuthPopup, setShowSettingsPopup, setUser } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [currentTemplateId, setCurrentTemplateId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showDataMapping, setShowDataMapping] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setCurrentTemplateId(id);
    };
    window.addEventListener('canvaTemplateLoaded', handler);
    return () => window.removeEventListener('canvaTemplateLoaded', handler);
  }, []);

  const handleRemove = async () => {
    if (!currentTemplateId) {
      onRemove();
      return;
    }
    if (!window.confirm(`Delete template "${currentTemplateId}"? This cannot be undone.`)) return;
    try {
      await axios.delete('/api/templates/delete', { data: { id: currentTemplateId } });
      setCurrentTemplateId(null);
      window.dispatchEvent(new CustomEvent('canvaTemplateDeleted', { detail: { id: currentTemplateId } }));
      onRemove();
    } catch (err) {
      console.error('Delete failed', err);
      alert('Failed to delete template');
    }
  };

  const handleUserSave = async () => {
    if (!currentTemplateId || isSaving) return;
    setIsSaving(true);
    try {
      const content = pack(query.serialize(), dataMapping)[0];
      await axios.post('/api/templates/save-user', { id: currentTemplateId, content });
    } catch (err) {
      console.error('Save failed', err);
      alert('Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await axios.post('/api/auth/logout');
      setUser(null);
      setMenuOpen(false);
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  return (
    <>
    <div
      ref={ref}
      css={{
        background: '#0a0f1d',
        padding: '12px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 31,
        '@media (max-width: 900px)': {
          padding: 12,
        },
      }}
    >
      {!isMobile && (
        <div
          css={{
            fontSize: 36,
          }}
        >
          <a href="/" aria-label="Home">
            {logoComponent || (
              <img
                src={logoUrl || '/logo.svg'}
                css={{
                  maxWidth: 120,
                }}
              />
            )}
          </a>
        </div>
      )}
      <div css={{ marginRight: 'auto' }}>
        <div css={{ margin: isMobile ? '0 16px 0 0' : '0 16px' }}>
          <HeaderFileMenu designName={name} onRemove={handleRemove} />
        </div>
      </div>
      <div
        css={{ display: 'flex', alignItems: 'center', verticalAlign: 'middle' }}
      >
        <div css={{ display: 'flex', alignItems: 'center', columnGap: 15 }}>
          <EditInlineInput
            text={name}
            placeholder={t('header.untitledDesign', 'Untitled design')}
            autoRow={false}
            styles={{
              placeholderColor: 'hsla(0,0%,100%,.5)',
            }}
            onSetText={(newText) => {
              setName(newText);
              if (name !== newText) {
                onChanges(newText);
                actions.setName(newText);
              }
            }}
            handleStyle={(isFocus) => {
              return {
                color: '#fff',
                borderRadius: 6,
                padding: 8,
                minHeight: 18,
                minWidth: 18,
                border: `1px solid ${
                  isFocus ? 'hsla(0,0%,100%,.8)' : 'transparent'
                }`,
                ':hover': {
                  border: '1px solid hsla(0,0%,100%,.8)',
                },
              };
            }}
            inputCss={{
              borderBottomColor: 'transparent',
              backgroundColor: 'transparent',
            }}
          />
          <div css={{ color: 'hsla(0,0%,100%,.7)' }}>
            {saving ? <SyncingIcon /> : <SyncedIcon />}
          </div>
        </div>
        <div
          css={{
            margin: '0 16px',
          }}
        >
          <SettingDivider background="hsla(0,0%,100%,.15)" />
        </div>
        <div css={{ display: 'flex', columnGap: 15 }}>
          <EditorButton
            onClick={actions.history.undo}
            disabled={!query.history.canUndo()}
            styles={{
              disabledColor: 'hsla(0,0%,100%,.4)',
              color: '#fff',
            }}
            tooltip="Undo"
          >
            <BackIcon />
          </EditorButton>
          <EditorButton
            onClick={actions.history.redo}
            disabled={!query.history.canRedo()}
            styles={{
              disabledColor: 'hsla(0,0%,100%,.4)',
              color: '#fff',
            }}
            tooltip="Redo"
          >
            <NextIcon />
          </EditorButton>
        </div>
        {!isMobile && (
          <>
            <div
              css={{
                margin: '0 16px',
              }}
            >
              <SettingDivider background="hsla(0,0%,100%,.15)" />
            </div>
            {user?.role === 'user' && currentTemplateId && (
              <>
                <Button
                  onClick={handleUserSave}
                  disabled={isSaving}
                  css={{ opacity: isSaving ? 0.6 : 1, cursor: isSaving ? 'not-allowed' : 'pointer' }}
                >
                  <div css={{ fontSize: 20 }}>
                    {isSaving ? <SyncingIcon /> : <SyncedIcon />}
                  </div>
                  <span css={{ marginRight: 4, marginLeft: 4 }}>
                    {isSaving ? 'Saving...' : 'Save'}
                  </span>
                </Button>
                <div css={{ margin: '0 8px' }}>
                  <SettingDivider background="hsla(0,0%,100%,.15)" />
                </div>
              </>
            )}
            {currentTemplateId && (
              <>
                <Button onClick={() => setShowDataMapping(true)}>
                  <svg
                    css={{ width: 18, height: 18, flexShrink: 0 }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 3h18v4H3z" />
                    <path d="M3 10h18v4H3z" />
                    <path d="M3 17h18v4H3z" />
                    <path d="M8 5h8M8 12h8M8 19h8" />
                  </svg>
                  <span css={{ marginRight: 4, marginLeft: 6 }}>Data Mapping</span>
                </Button>
                <div css={{ margin: '0 8px' }}>
                  <SettingDivider background="hsla(0,0%,100%,.15)" />
                </div>
              </>
            )}
            <Button
              onClick={() => {
                actions.fireDownloadPNGCmd(0);
              }}
            >
              <div css={{ fontSize: 20 }}>
                <ExportIcon />
              </div>{' '}
              <span css={{ marginRight: 4, marginLeft: 4 }}>{t('header.export', 'Export')}</span>
            </Button>
            
            <div css={{ position: 'relative', marginLeft: 16 }} ref={menuRef}>
              {user ? (
                <>
                  <Button
                    onClick={() => setMenuOpen(!menuOpen)}
                    css={{
                      border: '1px solid hsla(0,0%,100%,.4)',
                      padding: '8px 16px',
                      background: menuOpen ? 'rgb(255 255 255 / 15%)' : 'rgb(255 255 255 / 7%)'
                    }}
                  >
                    <span css={{ marginRight: 4, marginLeft: 4 }}>{user.name || user.email}</span>
                  </Button>
                  {menuOpen && (
                    <ProfileMenu>
                      <MenuItem onClick={() => { setShowSettingsPopup(true); setMenuOpen(false); }}>Settings</MenuItem>
                      <MenuItem onClick={handleLogout}>Log out</MenuItem>
                    </ProfileMenu>
                  )}
                </>
              ) : (
                <Button
                  onClick={() => setShowAuthPopup(true)}
                  css={{
                    border: '1px solid hsla(0,0%,100%,.4)',
                    padding: '8px 16px',
                  }}
                >
                  <span css={{ marginRight: 4, marginLeft: 4 }}>Login</span>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
    {showDataMapping && currentTemplateId && (
      <DataMappingModal
        templateId={currentTemplateId}
        onClose={() => setShowDataMapping(false)}
      />
    )}
    </>
  );
};

export default forwardRef(HeaderLayout);
