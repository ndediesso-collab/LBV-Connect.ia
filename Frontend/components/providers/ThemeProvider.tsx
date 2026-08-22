"use client";

import {
  createContext,
  useContext,
  useEffect,
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

const ThemeContext =
  createContext<ThemeContextType | undefined>(
    undefined,
  );

export function ThemeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [theme, setThemeState] =
    useState<Theme>("light");

  const [supabase] = useState(() =>
    createClient(),
  );

  /*
   * Application réelle du thème au document.
   */
  useEffect(() => {
    const root =
      document.documentElement;

    root.classList.toggle(
      "dark",
      theme === "dark",
    );

    root.style.colorScheme = theme;
  }, [theme]);

  /*
   * Chargement du thème depuis Supabase.
   */
  useEffect(() => {
    let mounted = true;

    async function loadTheme() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user || !mounted) {
          return;
        }

        const { data, error } =
          await supabase
            .from("profiles")
            .select("theme")
            .eq("id", user.id)
            .maybeSingle();

        if (error) {
          console.error(
            "THEME LOAD ERROR:",
            error,
          );
          return;
        }

        if (
          mounted &&
          (data?.theme === "light" ||
            data?.theme === "dark")
        ) {
          setThemeState(data.theme);
        }
      } catch (error) {
        console.error(
          "THEME INITIALIZATION ERROR:",
          error,
        );
      }
    }

    loadTheme();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  /*
   * Modification du thème :
   * 1. interface immédiatement mise à jour
   * 2. préférence sauvegardée dans Supabase
   */
  async function setTheme(
    nextTheme: Theme,
  ) {
    const previousTheme = theme;

    setThemeState(nextTheme);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) {
        throw userError;
      }

      if (!user) {
        throw new Error(
          "Utilisateur non connecté.",
        );
      }

      const { error } =
        await supabase
          .from("profiles")
          .update({
            theme: nextTheme,
          })
          .eq("id", user.id);

      if (error) {
        throw error;
      }
    } catch (error) {
      console.error(
        "THEME UPDATE ERROR:",
        error,
      );

      // Retour à l'ancien thème si Supabase échoue.
      setThemeState(previousTheme);
    }
  }

  async function toggleTheme() {
    await setTheme(
      theme === "light"
        ? "dark"
        : "light",
    );
  }

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context =
    useContext(ThemeContext);

  if (!context) {
    throw new Error(
      "useTheme doit être utilisé à l'intérieur de ThemeProvider.",
    );
  }

  return context;
}