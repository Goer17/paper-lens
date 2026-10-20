import { useRef, useState } from 'react';
import { FilePlus2, Highlighter, LoaderCircle, Sparkles, SquareDashed } from 'lucide-react';

type Props = {
  uploading: boolean;
  folderName: string;
  onUpload: (files: File[]) => void;
};

export function EmptyReader({ uploading, folderName, onUpload }: Props) {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  function accept(files: FileList | null) {
    if (!files) return;
    const pdfs = Array.from(files).filter(
      (file) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'),
    );
    if (pdfs.length) onUpload(pdfs);
  }

  return (
    <div className="reader">
      <div className="empty-reader">
        <div className="empty-card">
          <div className="empty-mark">
            <FilePlus2 size={28} />
          </div>
          <h2>Open a paper, or add a new one</h2>

          <div
            className={`dropzone ${dragging ? 'dragging' : ''}`}
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              accept(event.dataTransfer.files);
            }}
          >
            {uploading ? (
              <LoaderCircle size={22} className="spin-icon" style={{ color: 'var(--accent)' }} />
            ) : (
              <FilePlus2 size={22} style={{ color: 'var(--accent)' }} />
            )}
            <span className="dz-title">
              {uploading ? 'UPLOADING…' : `Drop PDFs here${folderName ? ` → ${folderName}` : ''}`}
            </span>
            <span className="dz-sub">or click to choose files · multiple PDFs supported</span>
          </div>
          <input
            ref={input}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(event) => {
              accept(event.target.files);
              event.target.value = '';
            }}
          />

          <div className="empty-hints">
            <span className="empty-hint">
              <Highlighter size={11} /> highlight &amp; underline
            </span>
            <span className="empty-hint">
              <SquareDashed size={11} /> box figures
            </span>
            <span className="empty-hint">
              <Sparkles size={11} /> drag citations into the AI
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
