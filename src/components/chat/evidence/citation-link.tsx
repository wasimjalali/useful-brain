"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

type CitationLinkStore = {
  hovered: number | null;
  pinned: number | null;
  setHovered: (n: number | null) => void;
  togglePin: (n: number) => void;
  isActive: (n: number) => boolean;
};

const INERT: CitationLinkStore = {
  hovered: null,
  pinned: null,
  setHovered: () => {},
  togglePin: () => {},
  isActive: () => false,
};

const CitationLinkContext = createContext<CitationLinkStore>(INERT);

/** Holds the hovered and pinned citation numbers so chips, sources and passages darken together. */
export function CitationLinkProvider({ children }: { children: ReactNode }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const togglePin = useCallback((n: number) => setPinned((current) => (current === n ? null : n)), []);
  const store = useMemo<CitationLinkStore>(
    () => ({
      hovered,
      pinned,
      setHovered,
      togglePin,
      isActive: (n) => hovered === n || pinned === n,
    }),
    [hovered, pinned, togglePin],
  );
  return <CitationLinkContext.Provider value={store}>{children}</CitationLinkContext.Provider>;
}

export function useCitationLink() {
  return useContext(CitationLinkContext);
}

/** Props for one citation number: active flag plus hover and click handlers. */
export function useCitationBinding(n: number) {
  const store = useCitationLink();
  const { setHovered, togglePin } = store;
  return {
    active: store.isActive(n),
    onHover: (hovered: boolean) => {
      if (hovered) {
        setHovered(n);
      } else if (store.hovered === n) {
        setHovered(null);
      }
    },
    onClick: () => togglePin(n),
  };
}
