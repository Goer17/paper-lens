import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, PencilLine } from 'lucide-react';

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type PromptOptions = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type DialogState = {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  value: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (result: boolean | string | null) => void;
};

type DialogApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogApi | null>(null);

export function useConfirm(): DialogApi['confirm'] {
  const api = useContext(DialogContext);
  if (!api) throw new Error('useConfirm must be used inside DialogProvider');
  return api.confirm;
}

export function usePrompt(): DialogApi['prompt'] {
  const api = useContext(DialogContext);
  if (!api) throw new Error('usePrompt must be used inside DialogProvider');
  return api.prompt;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const active = useRef<DialogState | null>(null);

  const show = useCallback((next: DialogState) => {
    const previous = active.current;
    if (previous) previous.resolve(previous.kind === 'prompt' ? null : false);
    active.current = next;
    setDialog(next);
  }, []);

  const settle = useCallback((result: boolean | string | null) => {
    const current = active.current;
    if (!current) return;
    active.current = null;
    setDialog(null);
    current.resolve(result);
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) => {
      return new Promise<boolean>((resolve) => {
        show({
          kind: 'confirm',
          title: options.title,
          message: options.message,
          value: '',
          confirmLabel: options.confirmLabel ?? 'CONFIRM',
          cancelLabel: options.cancelLabel ?? 'CANCEL',
          danger: options.danger ?? false,
          resolve: (result) => resolve(result === true),
        });
      });
    },
    [show],
  );

  const prompt = useCallback(
    (options: PromptOptions) => {
      return new Promise<string | null>((resolve) => {
        show({
          kind: 'prompt',
          title: options.title,
          message: options.message,
          value: options.defaultValue ?? '',
          placeholder: options.placeholder,
          confirmLabel: options.confirmLabel ?? 'SAVE',
          cancelLabel: options.cancelLabel ?? 'CANCEL',
          danger: false,
          resolve: (result) => resolve(typeof result === 'string' ? result : null),
        });
      });
    },
    [show],
  );

  const cancel = useCallback(() => {
    settle(active.current?.kind === 'prompt' ? null : false);
  }, [settle]);

  const accept = useCallback(() => {
    const current = active.current;
    if (!current) return;
    if (current.kind === 'prompt') {
      const value = current.value.trim();
      if (!value) return;
      settle(value);
    } else {
      settle(true);
    }
  }, [settle]);

  useEffect(() => {
    if (!dialog) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, cancel]);

  const promptEmpty = dialog?.kind === 'prompt' && !dialog.value.trim();

  return (
    <DialogContext.Provider value={{ confirm, prompt }}>
      {children}
      {dialog && (
        <div
          className="dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) cancel();
          }}
        >
          <div
            className="dialog-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
          >
            <div className="dialog-head">
              <span className={`dialog-icon ${dialog.danger ? 'danger' : ''}`}>
                {dialog.kind === 'prompt' ? (
                  <PencilLine size={14} />
                ) : (
                  <AlertTriangle size={14} />
                )}
              </span>
              <h2 className="dialog-title" id="dialog-title">
                {dialog.title}
              </h2>
            </div>

            {dialog.message && <p className="dialog-message">{dialog.message}</p>}

            {dialog.kind === 'prompt' && (
              <input
                className="dialog-input"
                autoFocus
                spellCheck={false}
                value={dialog.value}
                placeholder={dialog.placeholder}
                onChange={(event) => {
                  const value = event.target.value;
                  if (active.current) active.current = { ...active.current, value };
                  setDialog((current) => (current ? { ...current, value } : current));
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && dialog.value.trim()) accept();
                }}
              />
            )}

            <div className="dialog-actions">
              <button
                className="btn"
                onClick={cancel}
                autoFocus={dialog.kind === 'confirm' && dialog.danger}
              >
                {dialog.cancelLabel}
              </button>
              <button
                className={`btn ${dialog.danger ? 'danger-fill' : 'primary'}`}
                onClick={accept}
                disabled={promptEmpty}
                autoFocus={dialog.kind === 'confirm' && !dialog.danger}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
