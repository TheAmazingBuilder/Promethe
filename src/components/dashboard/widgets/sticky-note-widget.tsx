"use client";

/** sticky-note widget - yellow-tinted markdown note (config-driven, no loader). */
import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import ReactMarkdown from "react-markdown";
import { stickyNoteConfigSchema } from "@/lib/dashboard/registry";

/** Restricted markdown - raw HTML escaped (same policy as comments). */
const MARKDOWN_ALLOWED: readonly string[] = [
  "p", "br", "strong", "em", "ul", "ol", "li", "blockquote", "code", "a", "h1",
  "h2", "h3", "h4", "hr",
];

function parseMarkdown(config: unknown): string {
  const parsed = stickyNoteConfigSchema.safeParse(config ?? {});
  return parsed.success ? String(parsed.data.markdown) : "";
}

export function StickyNoteWidget({ config }: { config: unknown }) {
  const t = useTranslations("dashboards");
  const markdown = parseMarkdown(config).trim();

  if (!markdown) {
    return (
      <p className="flex h-full items-center gap-2 text-sm text-muted-foreground">
        <Pencil className="h-4 w-4" aria-hidden="true" />
        {t("stickyNoteEmpty")}
      </p>
    );
  }

  return (
    <div className="prose-sm max-w-none text-sm">
      <ReactMarkdown
        allowedElements={MARKDOWN_ALLOWED as unknown as Array<keyof React.JSX.IntrinsicElements>}
        unwrapDisallowed
        components={{
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="nofollow noopener noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">
              {children}
            </blockquote>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
