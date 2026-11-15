"use client";

/**
 * v2.5 Module 8 — <PrivateImage /> (§3.2).
 *
 * Trade screenshots may show balances/account numbers. In BLUR mode with
 * blurScreenshots enabled they get a heavy CSS blur, revealed on hover/focus
 * (when revealOnHover is on). In HIDE mode screenshots stay visible — HIDE
 * masks text amounts, not images; blurring them is the BLUR variant's job.
 * The image source is of course still in the DOM (documented limit).
 */
import * as React from "react";
import {
  getPrivacyServerSnapshot,
  getPrivacySnapshot,
  subscribePrivacy,
} from "@/lib/privacy/store";
import { cn } from "@/lib/utils";

function usePrivacySnapshot() {
  return React.useSyncExternalStore(
    subscribePrivacy,
    getPrivacySnapshot,
    getPrivacyServerSnapshot
  );
}

export interface PrivateImageProps
  extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Alt text — always provided (accessibility), never blurred semantically. */
  alt: string;
}

export function PrivateImage({ alt, className, ...rest }: PrivateImageProps) {
  const privacy = usePrivacySnapshot();
  const blurred =
    privacy.mode === "BLUR" &&
    privacy.blurScreenshots &&
    (privacy.scope.hideCurrencyAmounts || privacy.scope.hideBalances);

  return (
    <img
      alt={alt}
      aria-hidden={blurred ? undefined : undefined}
      className={cn(className, blurred && "sensitive sensitive-img")}
      {...rest}
    />
  );
}

/**
 * Wraps a gallery/lightbox area: in BLUR mode the inner images blur until the
 * container is hovered/focused (CSS in globals.css).
 */
export function PrivateImageFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const privacy = React.useSyncExternalStore(
    subscribePrivacy,
    getPrivacySnapshot,
    getPrivacyServerSnapshot
  );
  const blurred = privacy.mode === "BLUR" && privacy.blurScreenshots;
  return (
    <span className={cn(blurred && "sensitive-img", className)}>{children}</span>
  );
}
