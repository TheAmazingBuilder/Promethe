"use client";

import * as React from "react";
import {
  BarChart3,
  Loader2,
  LogIn,
  ShieldCheck,
  Sigma,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ModeToggle } from "@/components/mode-toggle";
import { BrandMark } from "@/components/app/brand";
import { useSession } from "@/components/app/session-context";
import { apiFetch, ApiClientError } from "@/lib/api-client";
import { apiErrorMessage, validationMessage } from "@/lib/i18n-errors";
import { useI18n } from "@/i18n/i18n-provider";
import {
  loginSchema,
  signupSchema,
  zodFieldErrors,
} from "@/lib/auth/validators";
import type { SessionPayload } from "@/lib/auth/types";
import { useToast } from "@/hooks/use-toast";

const DEMO_CREDENTIALS = { email: "demo@tradejournal.app", password: "demo1234" };

export function AuthScreen() {
  const [tab, setTab] = React.useState<string>("login");
  const t = useTranslations("auth");

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 px-4 sm:px-6">
        <BrandMark />
        <ModeToggle />
      </header>

      <main className="grid flex-1 items-center gap-10 px-4 py-8 sm:px-6 lg:grid-cols-2 lg:gap-6">
        <BrandPanel />

        <section className="mx-auto w-full max-w-md" aria-label={t("sectionAria")}>
          <Tabs value={tab} onValueChange={setTab} className="gap-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">{t("tabLogin")}</TabsTrigger>
              <TabsTrigger value="signup">{t("tabSignup")}</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <LoginForm />
            </TabsContent>
            <TabsContent value="signup">
              <SignupForm />
            </TabsContent>
          </Tabs>

          <DemoHint />

          <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">
            {t("signupNote")}
          </p>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-1.5 px-4 py-3.5 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>
            <span className="font-medium text-foreground">Promethe</span> —{" "}
            {t("footerLeft")}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <a
              href="#/legal/mentions"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("legalMentions")}
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="#/legal/confidentialite"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("legalPrivacy")}
            </a>
            <span aria-hidden="true">·</span>
            <a
              href="#/legal/cookies"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("legalCookies")}
            </a>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <p className="tabular-nums">{t("footerRight")}</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ── Brand panel (desktop) ─────────────────────────────────────────────── */

function BrandPanel() {
  const t = useTranslations("auth");

  return (
    <section className="relative hidden h-full flex-col justify-center overflow-hidden border-r bg-card/40 p-10 lg:flex xl:p-16">
      {/* Decorative emerald glows */}
      <div
        className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -right-16 bottom-1/4 h-56 w-56 rounded-full bg-teal-500/10 blur-3xl"
        aria-hidden="true"
      />

      <div className="relative max-w-lg space-y-8">
        {/* Promethe — Phoenix 2, secondary logo, large use only (login screen). */}
        <img
          src="/brand/phoenix-2.png"
          alt=""
          aria-hidden="true"
          className="h-28 w-auto"
        />
        <div className="space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            {t("brandBadge")}
          </span>
          <h1 className="text-3xl font-bold leading-tight tracking-tight xl:text-4xl">
            {t("brandTitle1")}
            <br />
            {t("brandTitle2")}
          </h1>
          <p className="text-base leading-relaxed text-muted-foreground">
            {t.rich("brandSubtitle", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>

        <ul className="space-y-4">
          <BrandFeature
            icon={<Sigma className="h-5 w-5" aria-hidden="true" />}
            title={t("feature1Title")}
            description={t("feature1Desc")}
          />
          <BrandFeature
            icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
            title={t("feature2Title")}
            description={t("feature2Desc")}
          />
          <BrandFeature
            icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
            title={t("feature3Title")}
            description={t("feature3Desc")}
          />
        </ul>

        <div className="flex flex-wrap gap-2">
          {[t("chip1"), t("chip2"), t("chip3")].map(
            (chip) => (
              <span
                key={chip}
                className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground"
              >
                {chip}
              </span>
            )
          )}
        </div>
      </div>
    </section>
  );
}

function BrandFeature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <li className="flex gap-3.5">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        aria-hidden="true"
      >
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-sm leading-snug text-muted-foreground">
          {description}
        </p>
      </div>
    </li>
  );
}

/* ── Login ─────────────────────────────────────────────────────────────── */

function LoginForm() {
  const { setSession } = useSession();
  const { toast } = useToast();
  const t = useTranslations("auth");
  const tRoot = useTranslations();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Client-side pre-validation — the server re-validates with the same schema.
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const payload = await apiFetch<SessionPayload>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      toast({
        title: t("welcomeToastTitle", { name: payload.profile.displayName }),
        description: t("welcomeToastDesc"),
      });
      setSession(payload);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFormError(apiErrorMessage(tRoot, error.code, error.message));
        setFieldErrors(error.fieldErrors ?? {});
      } else {
        setFormError(tRoot("errors.api.NETWORK"));
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError message={formError} />

      <div className="space-y-2">
        <Label htmlFor="login-email">{t("email")}</Label>
        <Input
          id="login-email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
        />
        <FieldError id="login-email-error" messages={fieldErrors.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="login-password">{t("password")}</Label>
        <Input
          id="login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-invalid={Boolean(fieldErrors.password)}
          aria-describedby={
            fieldErrors.password ? "login-password-error" : undefined
          }
        />
        <FieldError id="login-password-error" messages={fieldErrors.password} />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <LogIn className="h-4 w-4" aria-hidden="true" />
        )}
        {loading ? t("loginLoading") : t("login")}
      </Button>
    </form>
  );
}

/* ── Signup ────────────────────────────────────────────────────────────── */

function SignupForm() {
  const { setSession } = useSession();
  const { toast } = useToast();
  const t = useTranslations("auth");
  const tRoot = useTranslations();
  const { locale } = useI18n();
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [timezone, setTimezone] = React.useState("UTC");
  const [loading, setLoading] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  React.useEffect(() => {
    try {
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    } catch {
      // Keep UTC default.
    }
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const parsed = signupSchema.safeParse({
      email,
      password,
      displayName: displayName.trim() || undefined,
      timezone,
    });
    if (!parsed.success) {
      setFieldErrors(zodFieldErrors(parsed.error));
      return;
    }

    setLoading(true);
    try {
      const payload = await apiFetch<SessionPayload>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ ...parsed.data, locale }),
      });
      toast({
        title: t("welcomeToastTitle", { name: payload.profile.displayName }),
        description: t("accountCreatedToastDesc"),
      });
      setSession(payload);
    } catch (error) {
      if (error instanceof ApiClientError) {
        setFormError(apiErrorMessage(tRoot, error.code, error.message));
        setFieldErrors(error.fieldErrors ?? {});
      } else {
        setFormError(tRoot("errors.api.NETWORK"));
      }
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      <FormError message={formError} />

      <div className="space-y-2">
        <Label htmlFor="signup-name">{t("displayName")}</Label>
        <Input
          id="signup-name"
          type="text"
          autoComplete="name"
          placeholder={t("displayNamePlaceholder")}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={60}
          aria-describedby="signup-name-hint"
        />
        <p id="signup-name-hint" className="text-xs text-muted-foreground">
          {t("displayNameHint")}
        </p>
        <FieldError messages={fieldErrors.displayName} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-email">{t("email")}</Label>
        <Input
          id="signup-email"
          type="email"
          autoComplete="email"
          placeholder={t("emailPlaceholder")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={fieldErrors.email ? "signup-email-error" : undefined}
        />
        <FieldError id="signup-email-error" messages={fieldErrors.email} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="signup-password">{t("password")}</Label>
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-describedby="signup-password-hint"
        />
        <p id="signup-password-hint" className="text-xs text-muted-foreground">
          {t("passwordHint")}
        </p>
        <FieldError messages={fieldErrors.password} />
      </div>

      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <UserPlus className="h-4 w-4" aria-hidden="true" />
        )}
        {loading ? t("signupLoading") : t("signup")}
      </Button>
    </form>
  );
}

/* ── Demo hint ─────────────────────────────────────────────────────────── */

function DemoHint() {
  const { setSession } = useSession();
  const { toast } = useToast();
  const t = useTranslations("auth");
  const [loading, setLoading] = React.useState(false);

  async function loginDemo() {
    setLoading(true);
    try {
      const payload = await apiFetch<SessionPayload>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(DEMO_CREDENTIALS),
      });
      toast({
        title: t("welcomeToastTitle", { name: payload.profile.displayName }),
        description: t("demoToastDesc"),
      });
      setSession(payload);
    } catch {
      toast({
        title: t("demoUnavailableTitle"),
        description: t("demoUnavailableDesc"),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="mt-6 border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{t("demoTitle")}</CardTitle>
        <CardDescription className="text-xs">
          {t("demoDesc", {
            email: DEMO_CREDENTIALS.email,
            password: DEMO_CREDENTIALS.password,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={loginDemo}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {loading ? t("loginLoading") : t("demoButton")}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Shared bits ───────────────────────────────────────────────────────── */

function FieldError({ messages, id }: { messages?: string[]; id?: string }) {
  const tRoot = useTranslations();
  if (!messages || messages.length === 0) return null;
  return (
    <p id={id} className="text-xs text-destructive">
      {validationMessage(tRoot, messages[0])}
    </p>
  );
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="destructive">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
