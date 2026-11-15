"use client";

/**
 * v2.5 Module 2 — SVG → PNG export (client util).
 *
 * Serializes the first <svg> inside a container (Recharts output), draws it
 * onto a canvas at 2× resolution and triggers a download. Limitation (document
 * in README): web fonts are not embedded — system font metrics are used.
 */

export async function exportSvgToPng(
  container: HTMLElement | null,
  filename: string,
  background = "transparent"
): Promise<boolean> {
  if (!container) return false;
  const svg = container.querySelector("svg");
  if (!svg) return false;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Inline the CSS custom properties the chart consumes (var(--chart-1)…)
  // — standalone SVG files do not load the page stylesheet.
  const style = document.createElement("style");
  const vars = [
    "--chart-1",
    "--chart-2",
    "--chart-3",
    "--chart-4",
    "--chart-5",
    "--gain",
    "--loss",
    "--neutral",
    "--border",
    "--muted-foreground",
    "--foreground",
    "--muted",
    "--popover",
    "--background",
  ];
  const varCss = vars
    .map((v) => `${v}: ${getComputedStyle(document.documentElement).getPropertyValue(v)};`)
    .join("");
  style.textContent = `:root{${varCss}} text{font-family: system-ui, sans-serif;}`;
  clone.insertBefore(style, clone.firstChild);

  const svgText = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("svg load failed"));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    if (background !== "transparent") {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const pngUrl = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = pngUrl;
    a.download = filename.endsWith(".png") ? filename : `${filename}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Download any text content as a file (CSV export). */
export function downloadTextFile(
  content: string,
  filename: string,
  mime = "text/csv;charset=utf-8"
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
