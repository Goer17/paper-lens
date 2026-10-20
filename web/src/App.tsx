import { useCallback, useEffect, useState } from 'react';
import {
  BookOpenText,
  LoaderCircle,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';
import type { Annotation, Collection, Paper, Settings } from './lib/types';
import {
  api,
  clearToken,
  getToken,
  onUnauthorized,
  setToken as persistToken,
} from './lib/api';
import { Login } from './components/Login';
import { Sidebar, type LibrarySelection } from './components/Sidebar';
import { Reader } from './components/Reader';
import { ChatPanel } from './components/ChatPanel';
import { SettingsModal } from './components/SettingsModal';
import { EmptyReader } from './components/EmptyReader';
import { ToastStack, type Toast } from './components/ToastStack';
import type { AnnotationDraft } from './components/PdfPage';

const DEFAULT_SETTINGS: Settings = {
  theme_color: '#5b67f1',
  ai_language: 'English',
  notes_rail: '1',
};

export default function App() {
  const [token, setTokenState] = useState(getToken());
  const [booting, setBooting] = useState(true);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [languages, setLanguages] = useState<string[]>(['English', 'Chinese']);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [uncategorized, setUncategorized] = useState(0);
  const [papers, setPapers] = useState<Paper[]>([]);
  const [selection, setSelection] = useState<LibrarySelection>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [papersVersion, setPapersVersion] = useState(0);
  const [activePaper, setActivePaper] = useState<Paper | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('pr-sidebar') !== '0');
  const [notesOpen, setNotesOpen] = useState(settings.notes_rail !== '0');
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focusCitation, setFocusCitation] = useState<{ label: string; nonce: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((message: string, kind: Toast['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current.slice(-3), { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4600);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const bootstrap = useCallback(async () => {
    const [settingsData, collectionData] = await Promise.all([
      api.settings(),
      api.collections(),
    ]);
    setSettings(settingsData.settings);
    setLanguages(settingsData.languages);
    setCollections(collectionData.collections);
    setUncategorized(collectionData.uncategorized);
    setNotesOpen(settingsData.settings.notes_rail !== '0');
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', settings.theme_color);
  }, [settings.theme_color]);

  useEffect(() => {
    localStorage.setItem('pr-sidebar', sidebarOpen ? '1' : '0');
  }, [sidebarOpen]);

  useEffect(() => {
    const unsubscribe = onUnauthorized(() => {
      clearToken();
      setTokenState('');
      setActivePaper(null);
      setSettingsOpen(false);
      pushToast('Session expired. Enter the access token again.', 'error');
    });
    return unsubscribe;
  }, [pushToast]);

  // Initial authentication from localStorage or ?token=….
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      persistToken(urlToken);
      params.delete('token');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
    const candidate = urlToken || getToken();

    if (!candidate) {
      setBooting(false);
      return;
    }

    (async () => {
      try {
        persistToken(candidate);
        await api.me();
        if (cancelled) return;
        setTokenState(candidate);
        await bootstrap();
      } catch {
        if (!cancelled) {
          clearToken();
          setTokenState('');
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootstrap]);

  // Load the paper list whenever the library view or search changes.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const collectionId =
        selection.kind === 'collection'
          ? selection.id
          : selection.kind === 'uncategorized'
            ? 'none'
            : undefined;
      api
        .papers({ collectionId, q: search.trim() || undefined })
        .then((data) => {
          if (!cancelled) setPapers(data.papers);
        })
        .catch((error) => {
          if (!cancelled) {
            pushToast(error instanceof Error ? error.message : 'Could not load papers.', 'error');
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [token, selection, search, papersVersion, pushToast]);

  const activePaperId = activePaper?.id ?? null;

  // Load annotations for the open paper. Keyed by id so updating the paper's
  // annotation counter does not refetch the list.
  useEffect(() => {
    if (!activePaperId) {
      setAnnotations([]);
      return;
    }
    let cancelled = false;
    api
      .annotations(activePaperId)
      .then((data) => {
        if (!cancelled) setAnnotations(data.annotations);
      })
      .catch((error) => {
        if (!cancelled) {
          pushToast(error instanceof Error ? error.message : 'Could not load annotations.', 'error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePaperId, pushToast]);

  const refreshPapers = useCallback(() => setPapersVersion((value) => value + 1), []);

  const refreshCollections = useCallback(async () => {
    try {
      const data = await api.collections();
      setCollections(data.collections);
      setUncategorized(data.uncategorized);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not refresh folders.', 'error');
    }
  }, [pushToast]);

  async function handleLogin(newToken: string) {
    persistToken(newToken);
    setTokenState(newToken);
    setBooting(true);
    try {
      await bootstrap();
      pushToast('Workspace unlocked.', 'success');
    } catch (error) {
      clearToken();
      setTokenState('');
      pushToast(error instanceof Error ? error.message : 'Sign in failed.', 'error');
    } finally {
      setBooting(false);
    }
  }

  function signOut() {
    clearToken();
    setTokenState('');
    setActivePaper(null);
    setChatOpen(false);
    setSettingsOpen(false);
    pushToast('Signed out on this browser.');
  }

  function openPaper(paper: Paper) {
    if (paper.id !== activePaper?.id) setAnnotations([]);
    setActivePaper(paper);
    setFocusCitation(null);
    setSidebarOpen((open) => (window.innerWidth < 820 ? false : open));
  }

  async function uploadPapers(files: File[], collectionId: string | null) {
    setUploading(true);
    try {
      const result = await api.uploadPapers(files, collectionId);
      pushToast(
        `${result.papers.length} PDF${result.papers.length === 1 ? '' : 's'} added.`,
        'success',
      );
      refreshPapers();
      void refreshCollections();
      if (result.papers[0]) openPaper(result.papers[0]);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function createCollection(name: string, parentId: string | null) {
    const collection = await api.createCollection(name, parentId);
    await refreshCollections();
    setSelection({ kind: 'collection', id: collection.id });
    pushToast(
      parentId
        ? `Subfolder "${collection.name}" created.`
        : `Folder "${collection.name}" created.`,
      'success',
    );
  }

  async function renameCollection(collection: Collection, name: string) {
    try {
      await api.renameCollection(collection.id, name);
      await refreshCollections();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Rename failed.', 'error');
    }
  }

  async function moveCollection(collectionId: string, parentId: string | null) {
    try {
      await api.moveCollection(collectionId, parentId);
      await refreshCollections();
      pushToast(parentId ? 'Folder moved.' : 'Folder moved to the root.');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not move folder.', 'error');
    }
  }

  async function deleteCollection(collection: Collection) {
    try {
      await api.deleteCollection(collection.id);
      if (selection.kind === 'collection' && selection.id === collection.id) {
        setSelection({ kind: 'all' });
      }
      await refreshCollections();
      refreshPapers();
      pushToast('Folder deleted. Papers moved to Uncategorized.');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Delete failed.', 'error');
    }
  }

  async function deletePaper(paper: Paper) {
    try {
      await api.deletePaper(paper.id);
      if (activePaper?.id === paper.id) setActivePaper(null);
      refreshPapers();
      void refreshCollections();
      pushToast('Paper deleted.');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Delete failed.', 'error');
    }
  }

  async function renamePaper(paper: Paper, title: string) {
    try {
      await api.updatePaper(paper.id, { title });
      setPapers((current) =>
        current.map((item) => (item.id === paper.id ? { ...item, title } : item)),
      );
      setActivePaper((current) =>
        current?.id === paper.id ? { ...current, title } : current,
      );
      pushToast('Paper renamed.', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not rename paper.', 'error');
    }
  }

  async function movePaper(paperId: string, collectionId: string | null) {
    try {
      await api.updatePaper(paperId, { collection_id: collectionId });
      if (activePaper?.id === paperId) {
        setActivePaper({ ...activePaper, collection_id: collectionId });
      }
      refreshPapers();
      void refreshCollections();
      pushToast('Paper moved.');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Move failed.', 'error');
    }
  }

  async function createAnnotation(draft: AnnotationDraft) {
    if (!activePaper) return;
    const result = await api.createAnnotation({ paper_id: activePaper.id, ...draft });
    setAnnotations((current) => [...current, result.annotation]);
    setPapers((current) =>
      current.map((paper) =>
        paper.id === activePaper.id
          ? { ...paper, annotation_count: paper.annotation_count + 1 }
          : paper,
      ),
    );
    setActivePaper((current) =>
      current ? { ...current, annotation_count: current.annotation_count + 1 } : current,
    );
  }

  async function deleteAnnotation(id: string) {
    try {
      await api.deleteAnnotation(id);
      setAnnotations((current) => current.filter((annotation) => annotation.id !== id));
      if (activePaper) {
        setPapers((current) =>
          current.map((paper) =>
            paper.id === activePaper.id
              ? { ...paper, annotation_count: Math.max(0, paper.annotation_count - 1) }
              : paper,
          ),
        );
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not delete annotation.', 'error');
    }
  }

  async function updateAnnotationColor(id: string, color: string) {
    setAnnotations((current) =>
      current.map((annotation) => (annotation.id === id ? { ...annotation, color } : annotation)),
    );
    try {
      await api.updateAnnotation(id, { color });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not recolor annotation.', 'error');
    }
  }

  async function saveNote(id: string, note: string) {
    setAnnotations((current) =>
      current.map((annotation) => (annotation.id === id ? { ...annotation, note } : annotation)),
    );
    try {
      await api.updateAnnotation(id, { note });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not save note.', 'error');
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    const result = await api.updateSettings(patch);
    setSettings(result.settings);
  }

  function toggleNotes(open: boolean) {
    setNotesOpen(open);
    void api
      .updateSettings({ notes_rail: open ? '1' : '0' })
      .then((result) => setSettings(result.settings))
      .catch(() => undefined);
  }

  const defaultCollectionId =
    collections.find((collection) => !collection.parent_id)?.id ?? collections[0]?.id ?? null;
  const folderName =
    selection.kind === 'collection'
      ? collections.find((collection) => collection.id === selection.id)?.name ?? ''
      : selection.kind === 'uncategorized'
        ? 'Uncategorized'
        : collections[0]?.name ?? '';

  if (booting) {
    return (
      <div className="login-screen">
        <div className="loading-panel">
          <LoaderCircle size={18} className="spin-icon" /> LOADING WORKSPACE…
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <>
        <Login onLogin={(value) => void handleLogin(value)} />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
      </>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <BookOpenText size={14} />
          </span>
          <span className="brand-name">PAPERLENS</span>
          <span className="brand-version">v0.1</span>
        </div>
        <div className="topbar-divider" />
        <button
          className="icon-btn"
          onClick={() => setSidebarOpen((open) => !open)}
          title={sidebarOpen ? 'Collapse folders' : 'Show folders'}
        >
          {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
        </button>
        <div className="topbar-title">
          {activePaper ? (
            <>
              <span className="crumb">LIBRARY /</span> {activePaper.title}
            </>
          ) : (
            <span className="crumb">LIBRARY{folderName ? ` / ${folderName}` : ''}</span>
          )}
        </div>
        <div className="topbar-actions">
          <button
            className={`icon-btn ${chatOpen ? 'active' : ''}`}
            onClick={() => setChatOpen((open) => !open)}
            title="Toggle AI assistant"
            disabled={!activePaper}
          >
            <Sparkles size={15} />
          </button>
          <button
            className={`icon-btn ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(true)}
            title="Settings"
          >
            <SettingsIcon size={15} />
          </button>
          <button className="icon-btn" onClick={signOut} title="Sign out of this browser">
            <LogOut size={14} />
          </button>
        </div>
      </header>

      <div className="layout">
        <Sidebar
          collections={collections}
          uncategorized={uncategorized}
          papers={papers}
          selection={selection}
          search={search}
          activePaperId={activePaper?.id ?? null}
          uploading={uploading}
          collapsed={!sidebarOpen}
          onSelect={setSelection}
          onSearch={setSearch}
          onOpenPaper={openPaper}
          onDeletePaper={deletePaper}
          onRenamePaper={renamePaper}
          onMovePaper={movePaper}
          onUpload={uploadPapers}
          onCreateCollection={createCollection}
          onRenameCollection={renameCollection}
          onMoveCollection={moveCollection}
          onDeleteCollection={deleteCollection}
        />

        {activePaper ? (
          <Reader
            paper={activePaper}
            annotations={annotations}
            notesOpen={notesOpen}
            chatOpen={chatOpen}
            focusCitation={focusCitation}
            onToggleNotes={toggleNotes}
            onToggleChat={() => setChatOpen((open) => !open)}
            onCreateAnnotation={createAnnotation}
            onDeleteAnnotation={deleteAnnotation}
            onUpdateColor={updateAnnotationColor}
            onSaveNote={saveNote}
            onNotice={(message) => pushToast(message, 'error')}
          />
        ) : (
          <EmptyReader
            uploading={uploading}
            folderName={folderName}
            onUpload={(files) =>
              uploadPapers(
                files,
                selection.kind === 'collection'
                  ? selection.id ?? null
                  : selection.kind === 'uncategorized'
                    ? null
                    : defaultCollectionId,
              )
            }
          />
        )}

        {chatOpen && activePaper && (
          <ChatPanel
            paper={activePaper}
            annotations={annotations}
            onClose={() => setChatOpen(false)}
            onCitationClick={(label) => {
              setFocusCitation({ label, nonce: Date.now() });
            }}
            onNotice={(message) => pushToast(message, 'error')}
          />
        )}
      </div>

      {settingsOpen && (
        <SettingsModal
          settings={settings}
          languages={languages}
          onClose={() => setSettingsOpen(false)}
          onSaveSettings={saveSettings}
          onNotice={pushToast}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
