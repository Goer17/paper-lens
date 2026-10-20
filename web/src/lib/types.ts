export type Collection = {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: string;
  paper_count: number;
};

export type Paper = {
  id: string;
  title: string;
  filename: string;
  size: number;
  pages: number;
  collection_id: string | null;
  collection_name: string | null;
  annotation_count: number;
  created_at: string;
  last_opened_at: string | null;
};

export type Rect = { x: number; y: number; w: number; h: number };

export type Annotation = {
  id: string;
  paper_id: string;
  type: 'highlight' | 'underline' | 'box';
  page: number;
  label: string;
  color: string;
  rects: Rect[];
  text: string;
  note: string;
  image_name: string | null;
  image_url: string | null;
  created_at: string;
};

export type Settings = {
  theme_color: string;
  ai_language: string;
  notes_rail: string;
};

export type Model = {
  id: string;
  name: string;
  base_url: string;
  model_name: string;
  enabled: boolean;
  sort_order: number;
  created_at: string;
  has_key: boolean;
  key_hint: string;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  dir_name: string;
  file_count: number;
  created_at: string;
};

export type ToolTrace = {
  id: string;
  name: string;
  args: string;
  ok?: boolean;
  summary?: string;
};

export type Citation = {
  id: string;
  label: string;
  page: number;
  type: string;
  text: string;
  note: string;
  imageName: string | null;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  tools: ToolTrace[];
  model: string | null;
  created_at: string;
  streaming?: boolean;
  warning?: string;
};
