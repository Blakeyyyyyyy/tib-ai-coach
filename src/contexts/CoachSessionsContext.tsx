'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

type CoachSessionsContextValue = {
  /** Increment to refetch the conversation list (e.g. after new chat or new messages). */
  listVersion: number;
  bumpConversations: () => void;
};

const CoachSessionsContext = createContext<CoachSessionsContextValue | null>(
  null
);

export function CoachSessionsProvider({ children }: { children: React.ReactNode }) {
  const [listVersion, setListVersion] = useState(0);
  const bumpConversations = useCallback(() => {
    setListVersion((v) => v + 1);
  }, []);

  const value = useMemo(
    () => ({ listVersion, bumpConversations }),
    [listVersion, bumpConversations]
  );

  return (
    <CoachSessionsContext.Provider value={value}>
      {children}
    </CoachSessionsContext.Provider>
  );
}

export function useCoachSessions() {
  const ctx = useContext(CoachSessionsContext);
  if (!ctx) {
    throw new Error('useCoachSessions must be used within CoachSessionsProvider');
  }
  return ctx;
}
