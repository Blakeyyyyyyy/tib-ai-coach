'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  MessageSquare,
  CheckSquare,
  Calendar,
  Newspaper,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { useSidebar } from '@/contexts/SidebarContext';

const navItems = [
  { href: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { href: '/coach', label: 'AI Coach', icon: MessageSquare },
  { href: '/tasks', label: 'Tasks', icon: CheckSquare },
  { href: '/calendar', label: 'Calendar', icon: Calendar },
  { href: '/news', label: 'News', icon: Newspaper },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { collapsed, toggle } = useSidebar();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 bg-page border-r border-sidebar-border z-30 transition-all duration-300 ${
          collapsed ? 'lg:w-16' : 'lg:w-60'
        }`}
      >
        {/* Logo — links to Home */}
        <div className={`pt-6 pb-6 border-b border-sidebar-border flex items-center ${collapsed ? 'justify-center px-0' : 'px-5 justify-between'}`}>
          {!collapsed && (
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 min-w-0 rounded-lg -m-1 p-1 hover:bg-ink-50/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
            >
              <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shrink-0 shadow-sm">
                <span className="text-white font-bold text-xs">TiB</span>
              </div>
              <div className="min-w-0">
                <h1 className="text-ink-900 font-semibold text-sm leading-tight truncate">TiB AI Coach</h1>
                <p className="text-ink-400 text-xs truncate">Trade Coaching</p>
              </div>
            </Link>
          )}
          {collapsed && (
            <Link
              href="/dashboard"
              title="Home"
              className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shadow-sm hover:opacity-90 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2"
            >
              <span className="text-white font-bold text-xs">TiB</span>
            </Link>
          )}
        </div>

        {/* Nav Links */}
        <nav className={`flex-1 pt-4 space-y-0.5 ${collapsed ? 'px-2' : 'px-3'}`}>
          {navItems.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`flex items-center gap-3 rounded-lg text-sm font-medium transition-all duration-150 ${
                  collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'
                } ${
                  isActive
                    ? 'bg-brand-50 text-brand-600 border border-brand-100'
                    : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
                }`}
              >
                <Icon size={18} className="shrink-0" />
                {!collapsed && item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom */}
        <div className={`pb-5 space-y-0.5 border-t border-sidebar-border pt-4 ${collapsed ? 'px-2' : 'px-3'}`}>
          <button
            onClick={handleSignOut}
            title={collapsed ? 'Sign Out' : undefined}
            className={`flex items-center gap-3 rounded-lg text-sm font-medium text-ink-400 hover:bg-ink-50 hover:text-ink-900 transition-all duration-150 w-full ${
              collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'
            }`}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && 'Sign Out'}
          </button>

          {/* Collapse toggle */}
          <button
            onClick={toggle}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex items-center gap-3 rounded-lg text-sm font-medium text-ink-300 hover:bg-ink-50 hover:text-ink-500 transition-all duration-150 w-full ${
              collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'
            }`}
          >
            {collapsed ? <ChevronRight size={18} /> : (
              <>
                <ChevronLeft size={18} />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 inset-x-0 h-14 bg-page border-b border-sidebar-border flex items-center justify-between px-4 z-40">
        <Link
          href="/dashboard"
          className="flex items-center gap-2 rounded-lg -ml-1 pl-1 pr-2 py-1 hover:bg-ink-50/80 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          <div className="w-7 h-7 bg-brand-500 rounded-md flex items-center justify-center shadow-sm">
            <span className="text-white font-bold text-xs">TiB</span>
          </div>
          <span className="text-ink-900 font-semibold text-sm">TiB AI Coach</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="text-ink-500 hover:text-ink-900 p-1 transition-colors"
        >
          {mobileOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </header>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-page border-r border-sidebar-border flex flex-col">
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="px-5 pt-6 pb-6 border-b border-sidebar-border flex items-center gap-2.5 hover:bg-ink-50/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/30"
            >
              <div className="w-8 h-8 bg-brand-500 rounded-lg flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xs">TiB</span>
              </div>
              <div>
                <h1 className="text-ink-900 font-semibold text-sm leading-tight">TiB AI Coach</h1>
                <p className="text-ink-400 text-xs">Trade Coaching</p>
              </div>
            </Link>

            <nav className="flex-1 px-3 pt-4 space-y-0.5">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-brand-50 text-brand-600 border border-brand-100'
                        : 'text-ink-500 hover:bg-ink-50 hover:text-ink-900'
                    }`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="px-3 pb-6 border-t border-sidebar-border pt-4">
              <button
                onClick={handleSignOut}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-ink-400 hover:bg-ink-50 hover:text-ink-900 transition-all w-full"
              >
                <LogOut size={18} />
                Sign Out
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
