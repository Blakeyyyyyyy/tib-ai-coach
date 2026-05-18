'use client';

import CoachChat from '@/components/coach/CoachChat';

/**
 * New chat — chat UI only. Conversation history lives in `coach/layout.tsx` (ConversationPanel).
 */
export default function CoachPage() {
  return <CoachChat conversationId={null} />;
}
