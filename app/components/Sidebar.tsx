import { NavLink } from "@remix-run/react";
import React from "react";

import Logo from "~/components/Logo";
import ArrowRightIcon from "./icons/ArrowRight";
import CloseIcon from "./icons/Close";

const NAV_ITEMS = [
  {
    label: "Overview",
    href: "/overview",
    end: true,
  },
  {
    label: "Channels",
    href: "/channels",
    end: false,
  },
  {
    label: "Indexing Ops",
    href: "/indexing",
    end: true,
  },
  {
    label: "Indexing Testing",
    href: "/admin/indexing-testing",
    end: false,
  },
];

const FUTURE_ITEMS = ["Users", "Revenue", "Content Ops", "System Health"] as const;

type Props = {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
};

export default function Sidebar({ isOpen, setIsOpen }: Props) {
  return (
    <aside
      className={`fixed top-0 left-0 z-20 flex h-full p-2 w-2xs transition-transform ${
        isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}
    >
      <div className="flex flex-col gap-8 p-4 bg-white rounded-lg shadow-md grow">
        <div className="flex items-center justify-between gap-4">
          <Logo />
          <button
            className="flex items-center justify-center w-8 h-8 transition rounded-md cursor-pointer md:hidden text-slate-900 hover:bg-slate-100"
            onClick={() => setIsOpen(false)}
          >
            <CloseIcon />
          </button>
        </div>

        <div className="overflow-x-hidden overflow-y-scroll hide-scrollbar">
          <ul className="border-t border-slate-200">
            {NAV_ITEMS.map((item) => (
              <li key={item.label}>
                <NavLink
                  to={item.href}
                  className={({ isActive }) =>
                    isActive
                      ? "flex items-center justify-between px-2 py-4 border-b border-cyan-300"
                      : "flex items-center justify-between px-2 py-4 border-b border-slate-200 group hover:border-cyan-300"
                  }
                  end={item.end}
                >
                  {({ isActive }) => (
                    <>
                      {item.label}
                      <span
                        className={
                          isActive
                            ? "text-cyan-300"
                            : "text-slate-300 group-hover:text-cyan-300"
                        }
                      >
                        <ArrowRightIcon />
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
            {FUTURE_ITEMS.map((item) => (
              <li key={item}>
                <div className="flex items-center justify-between px-2 py-4 border-b border-slate-200 text-slate-400">
                  <span>{item}</span>
                  <span className="text-xs uppercase tracking-wide">Soon</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
