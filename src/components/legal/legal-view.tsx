"use client";

/**
 * v3 Phase 6 — Legal pages: /legal/terms, /legal/privacy,
 * /legal/cookies. Public (rendered even when logged out — AppRoot routes
 * here instead of the auth screen), i18n FR/EN, content parameterised by the
 * LEGAL_* server values (public /api/v1/legal endpoint, no personal data).
 */
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ArrowLeft, Cookie, ScrollText, ShieldCheck } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { BrandMark } from "@/components/app/brand";
import { cn } from "@/lib/utils";
import type { AppRoute } from "@/lib/router";

interface LegalIdentity {
  entityName: string;
  contactEmail: string;
  address: string;
  privacyContact: string;
  supervisoryAuthority: string;
}

type LegalPage = NonNullable<AppRoute["legalPage"]>;

const PAGES: { id: LegalPage; icon: typeof ScrollText; labelKey: string }[] = [
  { id: "terms", icon: ScrollText, labelKey: "tabMentions" },
  { id: "privacy", icon: ShieldCheck, labelKey: "tabPrivacy" },
  { id: "cookies", icon: Cookie, labelKey: "tabCookies" },
];

/** Section skeleton shared by the three pages. */
interface Section {
  titleKey: string;
  bodyKeys: string[];
}

const SECTIONS: Record<LegalPage, Section[]> = {
  terms: [
    { titleKey: "m.editor", bodyKeys: ["m.editorBody"] },
    { titleKey: "m.contact", bodyKeys: ["m.contactBody"] },
    { titleKey: "m.hosting", bodyKeys: ["m.hostingBody"] },
    { titleKey: "m.ip", bodyKeys: ["m.ipBody"] },
    { titleKey: "m.ipRights", bodyKeys: ["m.ipRightsBody"] },
    // v2.5 M2 Phase 7 — lightweight-charts / Recharts attribution.
    { titleKey: "m.licenses", bodyKeys: ["m.licensesBody"] },
  ],
  privacy: [
    { titleKey: "p.controller", bodyKeys: ["p.controllerBody"] },
    { titleKey: "p.data", bodyKeys: ["p.dataBody"] },
    { titleKey: "p.law", bodyKeys: ["p.lawBody"] },
    { titleKey: "p.retention", bodyKeys: ["p.retentionBody"] },
    { titleKey: "p.rights", bodyKeys: ["p.rightsBody"] },
    { titleKey: "p.export", bodyKeys: ["p.exportBody"] },
    { titleKey: "p.deletion", bodyKeys: ["p.deletionBody"] },
    { titleKey: "p.recipients", bodyKeys: ["p.recipientsBody"] },
    { titleKey: "p.dpo", bodyKeys: ["p.dpoBody"] },
    { titleKey: "p.authority", bodyKeys: ["p.authorityBody"] },
  ],
  cookies: [
    { titleKey: "c.what", bodyKeys: ["c.whatBody"] },
    { titleKey: "c.session", bodyKeys: ["c.sessionBody"] },
    { titleKey: "c.prefs", bodyKeys: ["c.prefsBody"] },
    { titleKey: "c.noTracking", bodyKeys: ["c.noTrackingBody"] },
    { titleKey: "c.manage", bodyKeys: ["c.manageBody"] },
  ],
};

export function LegalView({ page, standalone = false }: { page: LegalPage; standalone?: boolean }) {
  const t = useTranslations("legal");
  const identity = useQuery({
    queryKey: ["legal", "identity"],
    queryFn: () => apiFetch<LegalIdentity>("/api/v1/legal"),
    staleTime: 60 * 60 * 1000,
  });

  const values = {
    entity: identity.data?.entityName ?? "-",
    contact: identity.data?.contactEmail ?? "-",
    address: identity.data?.address ?? "-",
    privacy: identity.data?.privacyContact ?? "-",
    authority: identity.data?.supervisoryAuthority ?? "CNIL",
  };

  const content = (
    <div className="space-y-6">
      <nav aria-label={t("pagesAria")} className="flex flex-wrap gap-2">
        {PAGES.map((p) => {
          const active = p.id === page;
          const Icon = p.icon;
          return (
            <Link
              key={p.id}
              href={`/legal/${p.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                active
                  ? "border-emerald-500/60 bg-emerald-500/10 font-medium text-emerald-700 dark:text-emerald-400"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(p.labelKey)}
            </Link>
          );
        })}
      </nav>

      <article className="max-w-prose space-y-6">
        <PageHeader title={t(`title.${page}`)} />
        {SECTIONS[page].map((section) => (
          <section key={section.titleKey} className="space-y-1.5">
            <h2 className="text-sm font-semibold text-foreground">
              {t(section.titleKey, values)}
            </h2>
            {section.bodyKeys.map((key) => (
              <p key={key} className="text-sm leading-relaxed text-muted-foreground">
                {t(key, values)}
              </p>
            ))}
          </section>
        ))}
        <p className="border-t pt-4 text-xs text-muted-foreground">
          {t("lastUpdated")}
        </p>
      </article>
    </div>
  );

  if (!standalone) {
    return <div>{content}</div>;
  }

  // Logged-out layout: brand + content + back link, footer at the bottom.
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5 sm:px-6">
          <BrandMark />
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t("backToApp")}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6">
        {content}
      </main>
      <footer className="mt-auto border-t">
        <div className="mx-auto max-w-2xl px-4 py-3.5 text-xs text-muted-foreground sm:px-6">
          {t("footerNote")}
        </div>
      </footer>
    </div>
  );
}
