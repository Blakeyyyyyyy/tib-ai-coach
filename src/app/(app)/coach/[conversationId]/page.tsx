'use client';

import { useParams } from 'next/navigation';
import CoachChat from '@/components/coach/CoachChat';

export default function CoachThreadPage() {
  const params = useParams();
  const raw = params.conversationId;
  const conversationId = typeof raw === 'string' ? raw : null;

  return <CoachChat conversationId={conversationId} />;
}
