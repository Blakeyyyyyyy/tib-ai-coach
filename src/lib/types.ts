export interface Profile {
  id: string;
  email: string;
  full_name: string;
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

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  resources: Resource[] | null;
  tasks_created: TaskFromAI[] | null;
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
}
