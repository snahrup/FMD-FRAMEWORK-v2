import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

// ── Types ──

export type Persona = "business" | "engineering";

interface PersonaContextType {
  persona: Persona;
  setPersona: (p: Persona) => void;
  isBusiness: boolean;
  isEngineering: boolean;
  togglePersona: () => void;
}

const STORAGE_KEY = "fmd-persona";
const CUSTOM_EVENT = "fmd-persona-changed";

function readStoredPersona(): Persona {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "business" || stored === "engineering") return stored;
  } catch {
    // localStorage unavailable (SSR / sandboxed)
  }
  return "business";
}

const PersonaContext = createContext<PersonaContextType | null>(null);

export function usePersona() {
  const ctx = useContext(PersonaContext);
  if (!ctx) throw new Error("usePersona must be used within PersonaProvider");
  return ctx;
}

// ── Provider ──

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setPersonaState] = useState<Persona>(readStoredPersona);

  const setPersona = useCallback((next: Persona) => {
    setPersonaState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore write errors
    }
    window.dispatchEvent(new CustomEvent(CUSTOM_EVENT, { detail: { persona: next } }));
  }, []);

  const togglePersona = useCallback(() => {
    setPersonaState((prev) => {
      const next: Persona = prev === "business" ? "engineering" : "business";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore write errors
      }
      window.dispatchEvent(new CustomEvent(CUSTOM_EVENT, { detail: { persona: next } }));
      return next;
    });
  }, []);

  return (
    <PersonaContext.Provider
      value={{
        persona,
        setPersona,
        isBusiness: persona === "business",
        isEngineering: persona === "engineering",
        togglePersona,
      }}
    >
      {children}
    </PersonaContext.Provider>
  );
}
