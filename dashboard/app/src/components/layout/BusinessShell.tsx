// ============================================================================
// BusinessShell — Wrapper that applies the Business Portal design system
//
// Wraps content in .bp-shell class which activates BP CSS custom properties,
// fonts (Instrument Serif, Outfit, JetBrains Mono), and scoped styles.
//
// Engineering mode passes children through unstyled.
// ============================================================================

import { usePersona } from "@/contexts/PersonaContext";
import type { ReactNode } from "react";

export function BusinessShell({ children }: { children: ReactNode }) {
  const { isBusiness } = usePersona();

  if (!isBusiness) {
    return <>{children}</>;
  }

  return (
    <div className="bp-shell min-h-full">
      {children}
    </div>
  );
}
