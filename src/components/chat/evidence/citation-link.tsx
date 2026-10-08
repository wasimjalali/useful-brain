"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/** A citation is identified by its turn and its number: every turn has a [1]. */
type CitationKey = { turnId: string | null; n: number };

type CitationLinkStore = {
  hovered: CitationKey | null;
  pinned: CitationKey | null;
  setHovered: (key: CitationKey | null) => void;
  togglePin: (key: CitationKey) => void;
  isActive: (key: CitationKey) => boolean;
};

const INERT: CitationLinkStore = {
  hovered: null,
  pinned: null,
  setHovered: () => {},
  togglePin: () => {},
  isActive: () => false,
};

const CitationLinkContext = createContext<CitationLinkStore>(INERT);
const CitationScopeContext = createContext<string | null>(null);

function same(a: CitationKey | null, b: CitationKey): boolean {
  return a !== null && a.turnId === b.turnId && a.n === b.n;
}

/**
 * Holds the hovered and pinned citation so chips, sources and passages darken
 * together. The pin is dropped when `resetKey` moves from one value to another
 * (the open panel switched turn or document). Null means no panel is open, and
 * opening or closing it keeps the pin.
 */
export function CitationLinkProvider({
  children,
  resetKey,
}: {
  children: ReactNode;
  resetKey?: string | null;
}) {
  const [hovered, setHovered] = useState<CitationKey | null>(null);
  const [pinned, setPinned] = useState<CitationKey | null>(null);
  const previousKey = useRef<string | null>(resetKey ?? null);
  useEffect(() => {
    const previous = previousKey.current;
    previousKey.current = resetKey ?? null;
    if (previous && resetKey && previous !== resetKey) {
      setPinned(null);
    }
  }, [resetKey]);
  const togglePin = useCallback(
    (key: CitationKey) => setPinned((current) => (same(current, key) ? null : key)),
    [],
  );
  const store = useMemo<CitationLinkStore>(
    () => ({
      hovered,
      pinned,
      setHovered,
      togglePin,
      isActive: (key) => same(hovered, key) || same(pinned, key),
    }),
    [hovered, pinned, togglePin],
  );
  return <CitationLinkContext.Provider value={store}>{children}</CitationLinkContext.Provider>;
}

/** Names the turn the citations inside belong to. */
export function CitationScope({ turnId, children }: { turnId: string | null; children: ReactNode }) {
  return <CitationScopeContext.Provider value={turnId}>{children}</CitationScopeContext.Provider>;
}

export function useCitationLink() {
  return useContext(CitationLinkContext);
}

/** Props for one citation number: active flag plus hover and click handlers. */
export function useCitationBinding(n: number) {
  const store = useCitationLink();
  const turnId = useContext(CitationScopeContext);
  const { setHovered, togglePin } = store;
  const key: CitationKey = { turnId, n };
  return {
    active: store.isActive(key),
    onHover: (hovered: boolean) => {
      if (hovered) {
        setHovered(key);
      } else if (same(store.hovered, key)) {
        setHovered(null);
      }
    },
    onClick: () => togglePin(key),
  };
}
