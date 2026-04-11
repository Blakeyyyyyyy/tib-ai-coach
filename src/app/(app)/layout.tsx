'use client';

import Sidebar from '@/components/nav/Sidebar';
import { SidebarProvider, useSidebar } from '@/contexts/SidebarContext';

function AppLayoutInner({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar();
  return (
    <div className="min-h-screen bg-page">
      <Sidebar />
      <main
        className={`transition-all duration-300 pt-14 lg:pt-0 ${
          collapsed ? 'lg:pl-16' : 'lg:pl-60'
        }`}
      >
        {children}
      </main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppLayoutInner>{children}</AppLayoutInner>
    </SidebarProvider>
  );
}
