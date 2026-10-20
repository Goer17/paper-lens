import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Cpu,
  FlaskConical,
  Folder,
  FolderCog,
  LoaderCircle,
  Palette,
  Plus,
  Power,
  Settings as SettingsIcon,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { Model, Settings, Skill } from '../lib/types';
import { api } from '../lib/api';
import { THEME_PRESETS } from '../lib/constants';
import { useConfirm } from './DialogProvider';

type Props = {
  settings: Settings;
  languages: string[];
  onClose: () => void;
  onSaveSettings: (patch: Partial<Settings>) => Promise<void>;
  onNotice: (message: string, kind?: 'info' | 'error' | 'success') => void;
};

type Tab = 'basic' | 'models' | 'skills';

export function SettingsModal({
  settings,
  languages,
  onClose,
  onSaveSettings,
  onNotice,
}: Props) {
  const [tab, setTab] = useState<Tab>('basic');
  const [models, setModels] = useState<Model[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [themeDraft, setThemeDraft] = useState(settings.theme_color);
  const [busyId, setBusyId] = useState('');
  const [skillUploading, setSkillUploading] = useState(false);
  const skillInput = useRef<HTMLInputElement>(null);
  const confirm = useConfirm();

  const loadModels = useCallback(async () => {
    const data = await api.models();
    setModels(data.models);
  }, []);

  const loadSkills = useCallback(async () => {
    const data = await api.skills();
    setSkills(data.skills);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadModels(), loadSkills()])
      .catch((error) => {
        if (!cancelled) onNotice(error instanceof Error ? error.message : 'Could not load settings.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setThemeDraft(settings.theme_color);
  }, [settings.theme_color]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function saveSettings(patch: Partial<Settings>) {
    try {
      await onSaveSettings(patch);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not save setting.');
    }
  }

  function applyTheme(value: string) {
    setThemeDraft(value);
    if (/^#[0-9a-fA-F]{6}$/.test(value)) void saveSettings({ theme_color: value });
  }

  async function modelAction(id: string, action: () => Promise<void>) {
    setBusyId(id);
    try {
      await action();
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Model action failed.');
    } finally {
      setBusyId('');
    }
  }

  async function uploadSkill(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      onNotice('Upload a .zip archive containing the skill folder.', 'error');
      return;
    }
    setSkillUploading(true);
    try {
      const result = await api.uploadSkill(file);
      await loadSkills();
      onNotice(`Skill "${result.skill.name}" installed (${result.files.length} files).`, 'success');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Skill upload failed.', 'error');
    } finally {
      setSkillUploading(false);
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="settings-modal" role="dialog" aria-modal="true">
        <div className="settings-head">
          <SettingsIcon size={15} style={{ color: 'var(--accent)' }} />
          <span className="title">SETTINGS</span>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} title="Close settings">
            <X size={15} />
          </button>
        </div>

        <div className="tabs">
          <button className={`tab ${tab === 'basic' ? 'active' : ''}`} onClick={() => setTab('basic')}>
            <Palette size={12} /> Basic
          </button>
          <button className={`tab ${tab === 'models' ? 'active' : ''}`} onClick={() => setTab('models')}>
            <Cpu size={12} /> Models
          </button>
          <button className={`tab ${tab === 'skills' ? 'active' : ''}`} onClick={() => setTab('skills')}>
            <FolderCog size={12} /> Skills
          </button>
        </div>

        <div className="settings-body">
          {tab === 'basic' && (
            <>
              <div className="settings-section-title">APPEARANCE</div>
              <div className="setting-table">
                <div className="setting-row">
                  <div className="setting-label">Theme color</div>
                  <div className="setting-value">
                    <div className="swatches">
                      {THEME_PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          className={`swatch ${
                            settings.theme_color.toLowerCase() === preset.value.toLowerCase()
                              ? 'active'
                              : ''
                          }`}
                          style={{ background: preset.value }}
                          title={preset.name}
                          onClick={() => applyTheme(preset.value)}
                        />
                      ))}
                      <input
                        className="color-picker"
                        type="color"
                        value={/^#[0-9a-fA-F]{6}$/.test(themeDraft) ? themeDraft : '#5b67f1'}
                        onChange={(event) => applyTheme(event.target.value)}
                        title="Custom colour"
                      />
                      <input
                        className="color-hex"
                        value={themeDraft}
                        spellCheck={false}
                        onChange={(event) => setThemeDraft(event.target.value)}
                        onBlur={() => {
                          if (/^#[0-9a-fA-F]{6}$/.test(themeDraft)) {
                            void saveSettings({ theme_color: themeDraft });
                          } else {
                            setThemeDraft(settings.theme_color);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            if (/^#[0-9a-fA-F]{6}$/.test(themeDraft)) {
                              void saveSettings({ theme_color: themeDraft });
                            }
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === 'models' && (
            <>
              <div className="settings-section-title">PREFERENCES</div>
              <div className="setting-table">
                <div className="setting-row">
                  <div className="setting-label">Response language</div>
                  <div className="setting-value">
                    <select
                      className="select"
                      value={settings.ai_language}
                      onChange={(event) => void saveSettings({ ai_language: event.target.value })}
                    >
                      {languages.map((language) => (
                        <option key={language} value={language}>
                          {language}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="setting-row">
                  <div className="setting-label">Fallback strategy</div>
                  <div className="setting-value">
                    <span className="badge ok">AUTO FALLBACK</span>
                  </div>
                </div>
              </div>

              <div className="settings-section-title" style={{ marginTop: 18 }}>
                MODEL PRIORITY
              </div>
              <div className="models-list">
                {loading && (
                  <div className="loading-panel">
                    <span className="spinner" /> LOADING MODELS…
                  </div>
                )}
                {!loading && !models.length && (
                  <div className="sidebar-empty" style={{ border: '1px dashed var(--border)', borderRadius: 7 }}>
                    No models configured.
                  </div>
                )}
                {models.map((model, index) => (
                  <div
                    key={model.id}
                    className={`model-row ${model.enabled ? '' : 'disabled'}`}
                  >
                    <span className="model-priority">
                      {model.enabled ? index + 1 : '—'}
                    </span>
                    <div className="model-main">
                      <div className="model-name-line">
                        <span className="name">{model.name}</span>
                        <span className={`badge ${model.enabled ? 'ok' : 'off'}`}>
                          {model.enabled ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </div>
                      <span className="model-sub">
                        <span>{model.model_name}</span>
                        <span>·</span>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {model.base_url}
                        </span>
                        <span>·</span>
                        <span>{model.key_hint || 'no key'}</span>
                      </span>
                    </div>
                    <div className="model-controls">
                      <button
                        title="Move up"
                        disabled={index === 0 || Boolean(busyId)}
                        onClick={() =>
                          void modelAction(model.id, async () => {
                            const data = await api.moveModel(model.id, 'up');
                            setModels(data.models);
                          })
                        }
                      >
                        <ArrowUp size={10} />
                      </button>
                      <button
                        title="Move down"
                        disabled={index === models.length - 1 || Boolean(busyId)}
                        onClick={() =>
                          void modelAction(model.id, async () => {
                            const data = await api.moveModel(model.id, 'down');
                            setModels(data.models);
                          })
                        }
                      >
                        <ArrowDown size={10} />
                      </button>
                      <button
                        title="Test connection"
                        disabled={Boolean(busyId)}
                        onClick={() =>
                          void modelAction(model.id, async () => {
                            const result = await api.testModel(model.id);
                            onNotice(
                              `${model.name}: ${result.reply || 'ok'} · ${result.latency_ms} ms`,
                              'success',
                            );
                          })
                        }
                      >
                        {busyId === model.id ? (
                          <LoaderCircle size={10} className="spin-icon" />
                        ) : (
                          <FlaskConical size={10} />
                        )}
                      </button>
                      <button
                        title={model.enabled ? 'Disable and move to bottom' : 'Enable'}
                        onClick={() =>
                          void modelAction(model.id, async () => {
                            await api.updateModel(model.id, { enabled: !model.enabled });
                            await loadModels();
                          })
                        }
                      >
                        <Power size={10} /> {model.enabled ? 'DISABLE' : 'ENABLE'}
                      </button>
                      <button
                        className="danger"
                        title="Delete model"
                        onClick={() => {
                          void (async () => {
                            const ok = await confirm({
                              title: 'Delete model',
                              message: `Delete model "${model.name}"? This cannot be undone.`,
                              confirmLabel: 'DELETE',
                              danger: true,
                            });
                            if (!ok) return;
                            await modelAction(model.id, async () => {
                              await api.deleteModel(model.id);
                              await loadModels();
                            });
                          })();
                        }}
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <AddModelForm
                onCreated={async () => {
                  await loadModels();
                  onNotice('Model added at the lowest priority.', 'success');
                }}
                onNotice={onNotice}
              />
            </>
          )}

          {tab === 'skills' && (
            <>
              <div className="settings-section-title">AGENT SKILLS</div>
              <div className="skill-grid">
                {skills.map((skill) => (
                  <div className="skill-card" key={skill.id} title={skill.description}>
                    <div className="skill-folder">
                      <Folder size={14} />
                    </div>
                    <div className="skill-name">{skill.name}</div>
                    <div className="skill-desc">{skill.description}</div>
                    <div className="skill-foot">
                      <span>{skill.file_count} FILES</span>
                      <button
                        title="Delete skill"
                        onClick={() => {
                          void (async () => {
                            const ok = await confirm({
                              title: 'Delete skill',
                              message: `Delete skill "${skill.name}"?`,
                              confirmLabel: 'DELETE',
                              danger: true,
                            });
                            if (!ok) return;
                            try {
                              await api.deleteSkill(skill.id);
                              await loadSkills();
                              onNotice('Skill deleted.', 'success');
                            } catch (error) {
                              onNotice(
                                error instanceof Error ? error.message : 'Could not delete skill.',
                                'error',
                              );
                            }
                          })();
                        }}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}

                <button
                  className="skill-add"
                  disabled={skillUploading}
                  onClick={() => skillInput.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.currentTarget.classList.add('dragging');
                  }}
                  onDragLeave={(event) => event.currentTarget.classList.remove('dragging')}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.currentTarget.classList.remove('dragging');
                    void uploadSkill(event.dataTransfer.files?.[0]);
                  }}
                >
                  {skillUploading ? (
                    <LoaderCircle size={20} className="spin-icon" />
                  ) : (
                    <span className="plus">
                      <Plus size={14} />
                    </span>
                  )}
                  <span>{skillUploading ? 'EXTRACTING…' : 'UPLOAD SKILL .ZIP'}</span>
                </button>
              </div>
              <input
                ref={skillInput}
                type="file"
                accept=".zip,application/zip"
                style={{ display: 'none' }}
                onChange={(event) => {
                  void uploadSkill(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
              <div className="skills-note">
                <Check size={9} style={{ verticalAlign: '-1px', color: 'var(--ok)' }} /> Skills are
                read-only; uploaded scripts are never executed.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type AddProps = {
  onCreated: () => Promise<void>;
  onNotice: (message: string, kind?: 'info' | 'error' | 'success') => void;
};

function AddModelForm({ onCreated, onNotice }: AddProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    base_url: '',
    api_key: '',
    model_name: '',
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.createModel({
        name: form.name.trim() || form.model_name.trim(),
        base_url: form.base_url.trim(),
        api_key: form.api_key.trim(),
        model_name: form.model_name.trim(),
      });
      setForm({ ...form, name: '', api_key: '' });
      await onCreated();
      setOpen(false);
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not add model.', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="add-model-panel">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>ADD MODEL</h3>
        <button className="btn" onClick={() => setOpen((value) => !value)}>
          <Plus size={11} /> {open ? 'HIDE FORM' : 'NEW MODEL'}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} style={{ marginTop: 10 }}>
          <div className="form-grid">
            <div className="field">
              <label>Provider base URL</label>
              <input
                required
                value={form.base_url}
                onChange={(event) => setForm({ ...form, base_url: event.target.value })}
              />
            </div>
            <div className="field">
              <label>API key</label>
              <input
                required
                type="password"
                value={form.api_key}
                autoComplete="off"
                onChange={(event) => setForm({ ...form, api_key: event.target.value })}
              />
            </div>
            <div className="field">
              <label>Model name</label>
              <input
                required
                value={form.model_name}
                onChange={(event) => setForm({ ...form, model_name: event.target.value })}
              />
            </div>
            <div className="field">
              <label>Display name (optional)</label>
              <input
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
              />
            </div>
          </div>
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              CANCEL
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? <LoaderCircle size={11} className="spin-icon" /> : <Upload size={11} />}
              ADD MODEL
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
