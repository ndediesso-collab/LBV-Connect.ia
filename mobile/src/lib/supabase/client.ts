import "react-native-url-polyfill/auto";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import * as SecureStore from "expo-secure-store";

import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.warn(
    "EXPO_PUBLIC_SUPABASE_URL is not defined. Add it to the mobile project's .env file."
  );
}

if (!supabaseAnonKey) {
  console.warn(
    "EXPO_PUBLIC_SUPABASE_ANON_KEY is not defined. Add it to the mobile project's .env file."
  );
}

/**
 * Stockage sécurisé pour Android / iOS.
 */
const ExpoSecureStoreAdapter = {
  getItem: async (key: string) => {
    return SecureStore.getItemAsync(key);
  },

  setItem: async (key: string, value: string) => {
    await SecureStore.setItemAsync(key, value);
  },

  removeItem: async (key: string) => {
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Stockage navigateur pour Expo Web.
 */
const WebStorageAdapter = {
  getItem: async (key: string) => {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }

    return window.localStorage.getItem(key);
  },

  setItem: async (key: string, value: string) => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.setItem(key, value);
  },

  removeItem: async (key: string) => {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    window.localStorage.removeItem(key);
  },
};

/**
 * Expo Web → localStorage
 * Android/iOS → SecureStore
 */
const storage =
  Platform.OS === "web"
    ? WebStorageAdapter
    : ExpoSecureStoreAdapter;

export const supabase = createSupabaseClient(
  supabaseUrl ?? "",
  supabaseAnonKey ?? "",
  {
    auth: {
      storage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

// Compatibility helper used by the converted pages.
export const createClient = () => supabase;

export default supabase;