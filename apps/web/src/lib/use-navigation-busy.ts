"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export interface NavigationBusyState {
  readonly busy: boolean;
  readonly start: () => void;
  readonly stop: () => void;
}

// Tracks an action that calls the server and then navigates, staying busy across
// both phases. It clears on a pathname change — the moment the destination is
// actually on screen — so the overlay it drives can never outlive the navigation
// it was raised for, even in a component that survives the navigation.
export function useNavigationBusy(): NavigationBusyState {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [pathname]);

  return { busy, start: () => setBusy(true), stop: () => setBusy(false) };
}
