export interface Profile {
  id: string;
  email: string;
  full_name: string;
  tier: 'free' | 'paid';
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  event_date: string;
  location: string | null;
  event_url: string | null;
  is_featured: boolean;
  created_at: string;
}

export interface NewsPost {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  is_published: boolean;
  created_at: string;
}

export interface BusinessProfile {
  user_id: string;
  business_name: string | null;
  trade_type: string | null;
  team_size: number | null;
  years_in_business: number | null;
  current_main_challenge: string | null;
}

export interface Conversation {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  title: string;
  type: 'video' | 'podcast' | 'blog' | 'tool';
  description: string;
  link: string;
}

/** Citation from RAG — PDF proxy and/or Vimeo/video link. */
export interface RagSource {
  chunk_id: string;
  title: string;
  pdf_url: string | null;
  page_url?: string | null;
  video_url?: string | null;
  source_type?: 'pdf' | 'video_transcript';
  storage_bucket?: string | null;
  storage_path?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  resources: Resource[] | null;
  tasks_created: TaskFromAI[] | null;
  rag_sources?: RagSource[] | null;
  created_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: 'pending' | 'completed';
  source: 'ai' | 'manual';
  conversation_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskFromAI {
  title: string;
  description?: string;
}

export interface AIResponse {
  answer: string;
  next_steps: string[];
  tasks: TaskFromAI[];
  resources: Resource[];
  rag_sources?: RagSource[];
}

export interface Announcement {
  id: string;
  tag: string;
  title: string;
  summary: string | null;
  description: string | null;
  event_date: string | null;
  published: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}
