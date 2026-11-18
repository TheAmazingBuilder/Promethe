"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  CandlestickChart,
  ListChecks,
  NotebookPen,
  Search,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { navigate, useRoute } from "@/lib/router";
import { useGlobalSearch } from "@/hooks/use-productivity";
import { splitHighlight } from "@/lib/search/snippet";
import type { SearchResultItemDTO } from "@/lib/trading/dto";

/** /search - global search over trades, strategies and journal entries. */
export function SearchView() {
  const t = useTranslations("searchView");
  const route = useRoute();
  const [input, setInput] = React.useState(() => route.query?.q ?? "");
  const [query, setQuery] = React.useState(input);

  React.useEffect(() => {
    const handle = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(handle);
  }, [input]);

  const results = useGlobalSearch(query, 8);
  const data = results.data;

  const groups: Array<{
    key: "trades" | "strategies" | "journal";
    icon: typeof CandlestickChart;
    items: SearchResultItemDTO[];
  }> = [
    { key: "trades", icon: CandlestickChart, items: data?.trades ?? [] },
    { key: "strategies", icon: ListChecks, items: data?.strategies ?? [] },
    { key: "journal", icon: NotebookPen, items: data?.journal ?? [] },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{t("title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="relative max-w-xl">
        <Search
          className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          autoFocus
          className="pl-8"
          placeholder={t("placeholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && data && data.total > 0) {
              const first =
                data.trades[0] ?? data.strategies[0] ?? data.journal[0];
              if (first) navigate(first.href);
            }
          }}
        />
      </div>

      {query.length >= 2 && results.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {query.length >= 2 && !results.isLoading && data && (
        <>
          {data.total === 0 ? (
            <Card className="gap-0 py-4">
              <CardContent className="px-4">
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {t("noResults", { query })}
                </p>
              </CardContent>
            </Card>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("count", { count: data.total })}
            </p>
          )}
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <section key={group.key} aria-label={t(`group.${group.key}`)}>
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <group.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {t(`group.${group.key}`)}
                    <span className="text-muted-foreground">
                      ({group.items.length})
                    </span>
                  </h3>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate(item.href)}
                        className="block w-full rounded-lg border p-3 text-left transition-colors hover:bg-accent"
                      >
                        <span className="block text-sm font-medium">
                          {item.title}
                        </span>
                        {item.subtitle && (
                          <span className="block text-xs text-muted-foreground">
                            {item.subtitle}
                          </span>
                        )}
                        {item.snippet && (
                          <span className="mt-1 block text-sm text-muted-foreground">
                            <Highlight text={item.snippet} query={query} />
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </section>
              )
          )}
        </>
      )}

      {query.length < 2 && (
        <p className="text-sm text-muted-foreground">{t("hint")}</p>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitHighlight(text, query).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-primary/20 text-foreground">
            {part.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{part.text}</React.Fragment>
        )
      )}
    </>
  );
}
