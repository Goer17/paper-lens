import { useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  Library,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Collection, Paper } from '../lib/types';
import { useConfirm, usePrompt } from './DialogProvider';

export type LibrarySelection = { kind: 'all' | 'uncategorized' | 'collection'; id?: string };

type Props = {
  collections: Collection[];
  uncategorized: number;
  papers: Paper[];
  selection: LibrarySelection;
  search: string;
  activePaperId: string | null;
  uploading: boolean;
  collapsed: boolean;
  onSelect: (selection: LibrarySelection) => void;
  onSearch: (value: string) => void;
  onOpenPaper: (paper: Paper) => void;
  onDeletePaper: (paper: Paper) => void;
  onRenamePaper: (paper: Paper, title: string) => Promise<void>;
  onMovePaper: (paperId: string, collectionId: string | null) => void;
  onUpload: (files: File[], collectionId: string | null) => void;
  onCreateCollection: (name: string, parentId: string | null) => Promise<void>;
  onRenameCollection: (collection: Collection, name: string) => Promise<void>;
  onMoveCollection: (collectionId: string, parentId: string | null) => Promise<void>;
  onDeleteCollection: (collection: Collection) => Promise<void>;
};

type CreateTarget = { parentId: string | null };

export function Sidebar({
  collections,
  uncategorized,
  papers,
  selection,
  search,
  activePaperId,
  uploading,
  collapsed,
  onSelect,
  onSearch,
  onOpenPaper,
  onDeletePaper,
  onRenamePaper,
  onMovePaper,
  onUpload,
  onCreateCollection,
  onRenameCollection,
  onMoveCollection,
  onDeleteCollection,
}: Props) {
  const [creating, setCreating] = useState<CreateTarget | null>(null);
  const [newName, setNewName] = useState('');
  const [formError, setFormError] = useState('');
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();

  const total = collections.reduce((sum, item) => sum + item.paper_count, 0) + uncategorized;
  const rootCollection = collections.find((collection) => !collection.parent_id) ?? collections[0];
  const targetCollection =
    selection.kind === 'collection'
      ? selection.id ?? null
      : selection.kind === 'uncategorized'
        ? null
        : rootCollection?.id ?? null;

  const tree = useMemo(() => {
    const ids = new Set(collections.map((collection) => collection.id));
    const map = new Map<string, Collection[]>();
    for (const collection of collections) {
      const parent =
        collection.parent_id && ids.has(collection.parent_id) ? collection.parent_id : '__root__';
      const list = map.get(parent) ?? [];
      list.push(collection);
      map.set(parent, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }
    return map;
  }, [collections]);

  function handleFiles(files: FileList | null, collectionId: string | null) {
    if (!files?.length) return;
    const accepted = Array.from(files).filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (accepted.length) onUpload(accepted, collectionId);
  }

  function folderDrop(event: React.DragEvent, collectionId: string | null) {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const folderId = event.dataTransfer.getData('application/x-folder');
    if (folderId) {
      if (folderId !== collectionId) onMoveCollection(folderId, collectionId);
      return;
    }
    const paperId = event.dataTransfer.getData('application/x-paper');
    if (paperId) {
      onMovePaper(paperId, collectionId);
      return;
    }
    if (event.dataTransfer.files?.length) {
      handleFiles(event.dataTransfer.files, collectionId);
    }
  }

  function startCreate(parentId: string | null) {
    setCreating({ parentId });
    setNewName('');
    setFormError('');
    if (parentId) {
      setCollapsedIds((current) => {
        if (!current.has(parentId)) return current;
        const next = new Set(current);
        next.delete(parentId);
        return next;
      });
    }
  }

  async function renamePaper(paper: Paper) {
    const title = await prompt({
      title: 'Rename paper',
      message: 'Choose a title for this paper.',
      defaultValue: paper.title,
      confirmLabel: 'RENAME',
    });
    if (title?.trim() && title.trim() !== paper.title) {
      await onRenamePaper(paper, title.trim());
    }
  }

  async function submitNewFolder(event: React.FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || !creating) return;
    try {
      await onCreateCollection(name, creating.parentId);
      setNewName('');
      setFormError('');
      setCreating(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create folder.');
    }
  }

  function toggleCollapsed(id: string) {
    setCollapsedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function folderRow(collection: Collection, depth: number) {
    const children = tree.get(collection.id) ?? [];
    const hasChildren = children.length > 0;
    const expanded = !collapsedIds.has(collection.id);
    const isCreating = creating?.parentId === collection.id;
    const active = selection.kind === 'collection' && selection.id === collection.id;

    return (
      <div key={collection.id}>
        <div
          className={`folder-row ${active ? 'active' : ''} ${
            dropTarget === collection.id ? 'drop-target' : ''
          }`}
          style={{ paddingLeft: 4 + depth * 14 }}
          onClick={() => onSelect({ kind: 'collection', id: collection.id })}
          onDoubleClick={async () => {
            const name = await prompt({
              title: 'Rename folder',
              message: `Rename "${collection.name}"`,
              defaultValue: collection.name,
              confirmLabel: 'RENAME',
            });
            if (name?.trim() && name.trim() !== collection.name) {
              await onRenameCollection(collection, name.trim());
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDropTarget(collection.id);
          }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => folderDrop(event, collection.id)}
          draggable
          onDragStart={(event) => {
            if ((event.target as HTMLElement).closest('button')) {
              event.preventDefault();
              return;
            }
            event.dataTransfer.setData('application/x-folder', collection.id);
            event.dataTransfer.effectAllowed = 'move';
            (event.currentTarget as HTMLElement).classList.add('dragging');
          }}
          onDragEnd={(event) => {
            (event.currentTarget as HTMLElement).classList.remove('dragging');
          }}
          title="Drop a PDF here or drag a paper/folder to move it"
        >
          <button
            type="button"
            className="tree-toggle"
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggleCollapsed(collection.id);
              else startCreate(collection.id);
            }}
            title={hasChildren ? (expanded ? 'Collapse' : 'Expand') : 'Add subfolder'}
          >
            {hasChildren ? (
              expanded ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )
            ) : (
              <FolderPlus size={10} />
            )}
          </button>
          {expanded && hasChildren ? (
            <FolderOpen size={13} className="folder-icon" />
          ) : (
            <Folder size={13} className="folder-icon" />
          )}
          <span className="folder-name">{collection.name}</span>
          <span className="folder-count" title="Papers directly in this folder">
            {collection.paper_count}
          </span>
          <span className="folder-actions">
            <button
              type="button"
              title="New subfolder"
              onClick={(event) => {
                event.stopPropagation();
                startCreate(collection.id);
              }}
            >
              <FolderPlus size={11} />
            </button>
            <button
              type="button"
              title="Delete folder"
              onClick={async (event) => {
                event.stopPropagation();
                const ok = await confirm({
                  title: 'Delete folder',
                  message: `Delete folder "${collection.name}"?\n\nSubfolders will move up one level; papers directly inside will move to Uncategorized.`,
                  confirmLabel: 'DELETE',
                  danger: true,
                });
                if (ok) await onDeleteCollection(collection);
              }}
            >
              <Trash2 size={11} />
            </button>
          </span>
        </div>

        {isCreating && (
          <form
            className="inline-form folder-create-form"
            style={{ paddingLeft: 24 + depth * 14 }}
            onSubmit={submitNewFolder}
          >
            <input
              autoFocus
              placeholder={`New folder in ${collection.name}`}
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
                setFormError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setCreating(null);
                  setFormError('');
                }
              }}
            />
            <button className="primary" type="submit">
              ADD
            </button>
          </form>
        )}
        {isCreating && formError && (
          <div className="folder-form-error" style={{ paddingLeft: 24 + depth * 14 }}>
            {formError}
          </div>
        )}

        {hasChildren && expanded && children.map((child) => folderRow(child, depth + 1))}
      </div>
    );
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-inner">
        <div className="sidebar-top">
          <div className="search-wrap">
            <Search size={13} />
            <input
              className="search-input"
              placeholder="Search papers…"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
            {search && (
              <button className="search-clear" onClick={() => onSearch('')} title="Clear search">
                <X size={12} />
              </button>
            )}
          </div>
          <button
            className="add-pdf-btn"
            disabled={uploading}
            onClick={() => fileInput.current?.click()}
          >
            {uploading ? <LoaderCircle size={13} className="spin-icon" /> : <Upload size={13} />}
            {uploading ? 'UPLOADING PDF…' : 'ADD PDF'}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              handleFiles(event.target.files, targetCollection);
              event.target.value = '';
            }}
          />
        </div>

        <div className="side-section">
          <div className="section-head">
            <span className="section-label">FOLDERS</span>
            <button
              className="section-action"
              title="New root folder"
              onClick={() => startCreate(null)}
            >
              <FolderPlus size={12} />
            </button>
          </div>

          {creating?.parentId === null && (
            <form className="inline-form" onSubmit={submitNewFolder}>
              <input
                autoFocus
                placeholder="New root folder"
                value={newName}
                onChange={(event) => {
                  setNewName(event.target.value);
                  setFormError('');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setCreating(null);
                    setFormError('');
                  }
                }}
              />
              <button className="primary" type="submit">
                ADD
              </button>
            </form>
          )}
          {creating?.parentId === null && formError && (
            <div className="folder-form-error">{formError}</div>
          )}

          <div className="folder-list">
            <div
              className={`folder-row ${selection.kind === 'all' ? 'active' : ''} ${
                dropTarget === 'root' ? 'drop-target' : ''
              }`}
              onClick={() => onSelect({ kind: 'all' })}
              onDragOver={(event) => {
                event.preventDefault();
                setDropTarget('root');
              }}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(event) => folderDrop(event, null)}
              title="All papers. Drop a folder here to move it to the root."
            >
              <span className="tree-toggle-spacer" />
              <Library size={13} className="folder-icon" />
              <span className="folder-name">All Papers</span>
              <span className="folder-count">{total}</span>
            </div>

            {(tree.get('__root__') ?? []).map((collection) => folderRow(collection, 1))}

            {uncategorized > 0 && (
              <div
                className={`folder-row ${
                  selection.kind === 'uncategorized' ? 'active' : ''
                } ${dropTarget === 'none' ? 'drop-target' : ''}`}
                onClick={() => onSelect({ kind: 'uncategorized' })}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDropTarget('none');
                }}
                onDragLeave={() => setDropTarget(null)}
                onDrop={(event) => folderDrop(event, null)}
              >
                <span className="tree-toggle-spacer" />
                <Inbox size={13} className="folder-icon" />
                <span className="folder-name">Uncategorized</span>
                <span className="folder-count">{uncategorized}</span>
              </div>
            )}
          </div>
        </div>

        <div
          className="paper-section"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files')) event.preventDefault();
          }}
          onDrop={(event) => {
            if (event.dataTransfer.files?.length) {
              event.preventDefault();
              handleFiles(event.dataTransfer.files, targetCollection);
            }
          }}
        >
          <div className="section-head">
            <span className="section-label">
              {search ? 'SEARCH RESULTS' : 'PAPERS'} · {papers.length}
            </span>
            <Plus
              size={11}
              style={{ color: 'var(--muted)', cursor: 'pointer' }}
              onClick={() => fileInput.current?.click()}
            />
          </div>

          <div className="paper-list">
            {papers.map((paper) => (
              <div
                key={paper.id}
                className={`paper-item ${activePaperId === paper.id ? 'active' : ''}`}
                onClick={() => onOpenPaper(paper)}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData('application/x-paper', paper.id);
                  event.dataTransfer.effectAllowed = 'move';
                  (event.currentTarget as HTMLElement).classList.add('dragging');
                }}
                onDragEnd={(event) => {
                  (event.currentTarget as HTMLElement).classList.remove('dragging');
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onOpenPaper(paper);
                }}
                title={paper.title}
              >
                <div
                  className="paper-title"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    void renamePaper(paper);
                  }}
                  title="Double-click to rename"
                >
                  {paper.title}
                </div>
                <div className="paper-meta">
                  <FileText size={9} />
                  <span>{paper.pages}p</span>
                  <span className="dot" />
                  <span>{paper.annotation_count} notes</span>
                  {paper.collection_name && (
                    <>
                      <span className="dot" />
                      <span
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: 70,
                        }}
                      >
                        {paper.collection_name}
                      </span>
                    </>
                  )}
                </div>
                <button
                  className="paper-edit"
                  title="Rename paper"
                  onClick={(event) => {
                    event.stopPropagation();
                    void renamePaper(paper);
                  }}
                >
                  <Pencil size={11} />
                </button>
                <button
                  className="paper-delete"
                  title="Delete paper"
                  onClick={async (event) => {
                    event.stopPropagation();
                    const ok = await confirm({
                      title: 'Delete paper',
                      message: `Delete "${paper.title}" and all of its annotations?`,
                      confirmLabel: 'DELETE',
                      danger: true,
                    });
                    if (ok) await onDeletePaper(paper);
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}

            {!papers.length && (
              <div className="sidebar-empty">
                {search
                  ? 'No paper matches this search.'
                  : 'Nothing here yet. Drop a PDF here or use ADD PDF.'}
              </div>
            )}
          </div>
        </div>

        <div className="sidebar-foot">
          <span>
            <span className="status-dot" /> LOCAL · SQLITE
          </span>
          <span>MONO UI</span>
        </div>
      </div>
    </aside>
  );
}
