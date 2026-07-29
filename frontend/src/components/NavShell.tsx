import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { Logo } from "./Logo";
import {
  IconEvents,
  IconLive,
  IconLogout,
  IconRecordings,
  IconSettings,
  IconUsers,
} from "./icons";

const navItems = [
  { to: "/live", label: "Direct", icon: IconLive },
  { to: "/events", label: "Événements", icon: IconEvents },
  { to: "/recordings", label: "Enregistrements", icon: IconRecordings },
];

const adminNavItems = [
  { to: "/settings", label: "Caméras", icon: IconSettings },
  { to: "/settings/users", label: "Utilisateurs", icon: IconUsers },
];

function linkClasses(isActive: boolean) {
  return [
    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
    isActive ? "bg-accent-muted text-accent" : "text-muted hover:bg-surface2 hover:text-text",
  ].join(" ");
}

export function NavShell() {
  const { user, logout } = useAuth();
  const items = user?.role === "admin" ? [...navItems, ...adminNavItems] : navItems;

  return (
    <div className="flex h-full min-h-screen flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <Logo size={30} />
          <span className="text-lg font-semibold tracking-tight">CCAM</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end className={({ isActive }) => linkClasses(isActive)}>
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="px-2 pb-2 text-xs text-muted">
            {user?.username} · {user?.role === "admin" ? "admin" : "lecture seule"}
          </div>
          <button
            onClick={() => logout()}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface2 hover:text-danger"
          >
            <IconLogout />
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <Logo size={26} />
          <span className="text-base font-semibold tracking-tight">CCAM</span>
        </div>
        <button onClick={() => logout()} className="text-muted hover:text-danger">
          <IconLogout />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto bg-bg pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface md:hidden">
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              [
                "flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium",
                isActive ? "text-accent" : "text-muted",
              ].join(" ")
            }
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
