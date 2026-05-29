import Link from 'next/link';
import { Calendar, Megaphone, Newspaper, Shield } from 'lucide-react';

const sections = [
  {
    href: '/admin/calendar',
    title: 'Calendar events',
    description: 'Add, edit, and remove workshops and events shown on the Calendar page.',
    icon: Calendar,
  },
  {
    href: '/admin/news',
    title: 'News posts',
    description: 'Publish updates and articles shown on the News page.',
    icon: Newspaper,
  },
  {
    href: '/admin/announcements',
    title: 'Announcements',
    description: 'Manage in-app popup announcements for users.',
    icon: Megaphone,
  },
];

export default function AdminHomePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8 pb-16">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-ink-900 flex items-center gap-2">
          <Shield className="text-brand-500" size={28} />
          Admin
        </h1>
        <p className="text-sm text-ink-500 mt-1">
          Manage content shown to app users.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-1">
        {sections.map((section) => {
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className="flex items-start gap-4 rounded-xl border border-ink-100 bg-surface p-5 shadow-sm hover:border-brand-200 hover:shadow-md transition-all"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-50 flex items-center justify-center shrink-0">
                <Icon size={20} className="text-brand-600" />
              </div>
              <div>
                <h2 className="font-semibold text-ink-900">{section.title}</h2>
                <p className="text-sm text-ink-500 mt-1">{section.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
