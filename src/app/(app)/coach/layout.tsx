'use client';

import { useState } from 'react';
import { PanelLeft } from 'lucide-react';
import ConversationPanel from '@/components/coach/ConversationPanel';
import { CoachSessionsProvider } from '@/contexts/CoachSessionsContext';

export default function CoachLayout({ children }: { children: React.ReactNode }) {
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  return (
    <CoachSessionsProvider>
      <div className="flex flex-col lg:flex-row flex-1 min-h-0 h-[calc(100vh-3.5rem)] lg:h-screen w-full bg-[#ececf1] lg:bg-[#f4f4f5]">
        <ConversationPanel
          mobileOpen={mobilePanelOpen}
          onMobileClose={() => setMobilePanelOpen(false)}
        />

        <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden bg-surface lg:rounded-tl-xl lg:shadow-[inset_1px_0_0_0_rgba(0,0,0,0.06)]">
          <div className="lg:hidden flex items-center h-11 px-1 border-b border-black/[0.06] bg-surface shrink-0">
            <button
              type="button"
              onClick={() => setMobilePanelOpen(true)}
              className="flex items-center justify-center size-10 rounded-lg text-ink-700 hover:bg-black/[0.05] transition-colors"
              aria-label="Open chat history"
            >
              <PanelLeft size={22} strokeWidth={1.75} />
            </button>
          </div>

          <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden">{children}</div>
        </div>
      </div>
    </CoachSessionsProvider>
  );
}
