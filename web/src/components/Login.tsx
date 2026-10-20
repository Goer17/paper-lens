import { useState } from 'react';
import { FileLock2, KeyRound, LoaderCircle, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

type Props = {
  initialToken?: string;
  onLogin: (token: string) => void;
};

export function Login({ initialToken = '', onLogin }: Props) {
  const [token, setToken] = useState(initialToken);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = token.trim();
    if (!value) {
      setError('Paste the access token to continue.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.login(value);
      onLogin(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="brand-mark">
            <FileLock2 size={19} />
          </span>
          <div className="txt">
            <span className="name">PAPERLENS</span>
            <span className="tag">ANNOTATION-GROUNDED READING</span>
          </div>
        </div>

        <h1 className="login-title">Unlock your library</h1>

        <label className="login-label" htmlFor="token">
          ACCESS TOKEN
        </label>
        <div style={{ position: 'relative' }}>
          <KeyRound
            size={13}
            style={{
              position: 'absolute',
              left: 11,
              top: 13,
              color: 'var(--muted)',
              pointerEvents: 'none',
            }}
          />
          <input
            id="token"
            className="login-input"
            style={{ paddingLeft: 31 }}
            type="password"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </div>

        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? <LoaderCircle size={14} className="spin-icon" /> : <ShieldCheck size={14} />}
          {loading ? 'VERIFYING…' : 'ENTER WORKSPACE'}
        </button>

        {error && <div className="login-error">{error}</div>}

        <div className="login-foot">
          <span>PDF · ANNOTATIONS · AI</span>
          <span>v0.1.0</span>
        </div>
      </form>
    </div>
  );
}
