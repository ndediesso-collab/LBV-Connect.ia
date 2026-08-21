"use client";

import {
  ArrowLeft,
  Bell,
  ChevronRight,
  Globe,
  Languages,
  LogOut,
  Moon,
  Palette,
  Shield,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

export default function SettingsPage() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);

  return (
    <main className="min-h-dvh bg-white text-neutral-950">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/chat"
              aria-label="Retour au chat"
              className="rounded-xl p-2 text-neutral-600 transition hover:bg-neutral-100 hover:text-neutral-950"
            >
              <ArrowLeft size={19} />
            </Link>

            <div className="flex items-center gap-2">
              <Sparkles size={18} />
              <span className="font-semibold tracking-tight">
                LBV-Connect.ia
              </span>
            </div>
          </div>

          <Link
            href="/credits"
            className="text-sm font-medium text-neutral-600 transition hover:text-neutral-950"
          >
            Mes crédits
          </Link>
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
        <div>
          <p className="text-sm font-medium text-neutral-500">
            Votre compte
          </p>

          <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">
            Paramètres
          </h1>

          <p className="mt-2 text-sm leading-6 text-neutral-500">
            Gérez votre compte et vos préférences LBV-Connect.ia.
          </p>
        </div>

        {/* Account */}
        <SettingsSection
          icon={<UserRound size={18} />}
          title="Compte"
          description="Informations personnelles et sécurité."
        >
          <SettingsLink
            icon={<UserRound size={17} />}
            title="Informations personnelles"
            description="Nom, prénom et adresse e-mail"
          />

          <SettingsLink
            icon={<Shield size={17} />}
            title="Sécurité"
            description="Mot de passe et sessions actives"
          />
        </SettingsSection>

        {/* Preferences */}
        <SettingsSection
          icon={<Palette size={18} />}
          title="Préférences"
          description="Personnalisez votre expérience."
        >
          <SettingsRow
            icon={<Languages size={17} />}
            title="Langue"
            description="Langue de l'interface"
          >
            <select
              defaultValue="fr"
              className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-400"
            >
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </SettingsRow>

          <SettingsRow
            icon={<Globe size={17} />}
            title="Région"
            description="Pays et paramètres régionaux"
          >
            <span className="text-sm text-neutral-500">
              Gabon
            </span>
          </SettingsRow>

          <SettingsRow
            icon={<Moon size={17} />}
            title="Mode sombre"
            description="Modifier l'apparence de l'application"
          >
            <Toggle
              checked={darkMode}
              onChange={setDarkMode}
              label="Activer le mode sombre"
            />
          </SettingsRow>
        </SettingsSection>

        {/* Notifications */}
        <SettingsSection
          icon={<Bell size={18} />}
          title="Notifications"
          description="Choisissez les informations que vous souhaitez recevoir."
        >
          <SettingsRow
            icon={<Bell size={17} />}
            title="Notifications"
            description="Informations importantes sur votre compte et vos crédits"
          >
            <Toggle
              checked={notifications}
              onChange={setNotifications}
              label="Activer les notifications"
            />
          </SettingsRow>
        </SettingsSection>

        {/* Subscription */}
        <SettingsSection
          icon={<Sparkles size={18} />}
          title="Abonnement"
          description="Consultez votre accès actuel à LBV-Connect.ia."
        >
          <SettingsRow
            icon={<Sparkles size={17} />}
            title="Pack actuel"
            description="Votre accès et votre période de validité"
          >
            <Link
              href="/packs"
              className="flex items-center gap-1 text-sm font-medium hover:underline"
            >
              Léger
              <ChevronRight size={15} />
            </Link>
          </SettingsRow>

          <SettingsRow
            icon={<Sparkles size={17} />}
            title="Crédits"
            description="Consulter votre solde et votre consommation"
          >
            <Link
              href="/credits"
              className="flex items-center gap-1 text-sm font-medium hover:underline"
            >
              14 280
              <ChevronRight size={15} />
            </Link>
          </SettingsRow>
        </SettingsSection>

        {/* Logout */}
        <section className="mt-8">
          <button
            type="button"
            className="flex w-full items-center gap-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-left transition hover:bg-red-100"
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-red-600">
              <LogOut size={17} />
            </div>

            <div>
              <p className="text-sm font-medium text-red-700">
                Se déconnecter
              </p>

              <p className="mt-0.5 text-xs text-red-500">
                Fermer votre session actuelle
              </p>
            </div>
          </button>
        </section>

        <p className="mt-8 text-center text-xs text-neutral-400">
          LBV-Connect.ia · Version 1.0
        </p>
      </section>
    </main>
  );
}

function SettingsSection({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-200">
      <div className="border-b border-neutral-200 bg-neutral-50 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white">
            {icon}
          </div>

          <div>
            <h2 className="text-sm font-semibold">
              {title}
            </h2>

            <p className="mt-0.5 text-xs text-neutral-500">
              {description}
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-neutral-200 bg-white">
        {children}
      </div>
    </section>
  );
}

function SettingsLink({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-neutral-50"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-neutral-500">
          {description}
        </p>
      </div>

      <ChevronRight
        size={17}
        className="shrink-0 text-neutral-400"
      />
    </button>
  );
}

function SettingsRow({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>

        <p className="mt-0.5 text-xs leading-5 text-neutral-500">
          {description}
        </p>
      </div>

      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${
        checked ? "bg-neutral-950" : "bg-neutral-300"
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${
          checked ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}