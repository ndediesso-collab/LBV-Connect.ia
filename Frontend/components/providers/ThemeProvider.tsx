"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createClient } from "@/lib/supabase/client";

type Theme = "light" | "dark";

type ThemeContextType = {
  theme: Theme;
  setTheme: (theme: Theme) => Promise<void>;
  toggleTheme: () => Promise<void>;
};

const THEME_STORAGE_KEY = "oria_theme";
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

function validTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark";
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

function readInitialTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (validTheme(saved)) return saved;
  } catch {
    // Mode prive : on applique simplement la preference systeme.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function cacheTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Le profil Supabase reste l'autorite persistante du compte.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // La valeur SSR ne change pas : evite une divergence d'hydratation.
  // Le script avant hydration dans app/layout.tsx applique le visuel initial.
  const [theme, setThemeState] = useState<Theme>("light");
  const [ready, setReady] = useState(false);
  const [supabase] = useState(() => createClient());
  const themeRef = useRef<Theme>("light");
  const versionRef = useRef(0);
  const savingRef = useRef(false);

  useEffect(() => {
    const initial = readInitialTheme();
    themeRef.current = initial;
    setThemeState(initial);
    applyTheme(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    applyTheme(theme);
  }, [ready, theme]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const versionWhenStarted = versionRef.current;

    async function loadTheme() {
      try {
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) throw authError;
        if (!user || cancelled) return;

        const { data, error } = await supabase
          .from("profiles")
          .select("theme")
          .eq("id", user.id)
          .maybeSingle();
        if (error) throw error;

        // Ne jamais ecraser un choix fait pendant le chargement du profil.
        if (cancelled || versionWhenStarted !== versionRef.current) return;
        if (validTheme(data?.theme)) {
          themeRef.current = data.theme;
          setThemeState(data.theme);
          cacheTheme(data.theme);
        }
      } catch (error) {
        // L'interface reste utilisable avec le cache local / theme systeme.
        console.error("THEME LOAD ERROR:", error);
      }
    }

    void loadTheme();
    return () => { cancelled = true; };
  }, [ready, supabase]);

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY || !validTheme(event.newValue)) return;
      versionRef.current += 1;
      themeRef.current = event.newValue;
      setThemeState(event.newValue);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  async function setTheme(nextTheme: Theme): Promise<void> {
    if (!validTheme(nextTheme)) throw new Error("Theme ORIA invalide.");
    if (savingRef.current) throw new Error("Une sauvegarde de theme est deja en cours.");
    const previousTheme = themeRef.current;
    if (previousTheme === nextTheme) return;

    savingRef.current = true;
    const version = ++versionRef.current;
    // Mise a jour immediate, avant le retour reseau.
    themeRef.current = nextTheme;
    setThemeState(nextTheme);
    applyTheme(nextTheme);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error("Utilisateur non connecte.");

      const { error } = await supabase
        .from("profiles")
        .update({ theme: nextTheme })
        .eq("id", user.id);
      if (error) throw error;
      if (version === versionRef.current) cacheTheme(nextTheme);
    } catch (error) {
      // La page Settings doit recevoir l'erreur et afficher le vrai resultat.
      if (version === versionRef.current) {
        themeRef.current = previousTheme;
        setThemeState(previousTheme);
        applyTheme(previousTheme);
      }
      console.error("THEME UPDATE ERROR:", error);
      throw error;
    } finally {
      savingRef.current = false;
    }
  }

  async function toggleTheme(): Promise<void> {
    await setTheme(themeRef.current === "light" ? "dark" : "light");
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme doit etre utilise a l'interieur de ThemeProvider.");
  }
  return context;
}
