/**
 * Asset handling for problem descriptions: images linked from the raw HTML
 * are downloaded and their URLs rewritten to local relative paths in the
 * rendered markdown/typst output, so repositories stay self-contained.
 */

const IMG_SRC_RE = /<img\b[^>]*\bsrc=["']([^"']+)["']/gi;

/** Extracts absolute http(s) image src URLs from problem-description HTML. */
export function extractAssetUrls(html: string): string[] {
  const urls: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = IMG_SRC_RE.exec(html)) !== null) {
    const url = match[1]!;
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
}

/** Derives a filesystem-safe filename from an asset URL's last path segment. */
export function assetFilename(url: string): string {
  const path = url.split(/[?#]/)[0]!;
  let last = path.split("/").pop() ?? "";
  try {
    last = decodeURIComponent(last);
  } catch {
    /* keep the raw segment on malformed escapes */
  }
  const cleaned = last.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned || "asset";
}

/**
 * Rewrites asset URLs in HTML to local paths. Simple per-URL string
 * replacement — safe because the map keys are exact attribute values.
 */
export function rewriteAssetUrls(
  html: string,
  map: ReadonlyMap<string, string>
): string {
  let out = html;
  for (const [url, path] of map) {
    out = out.split(url).join(path);
  }
  return out;
}

/**
 * Computes a path for `toFile` relative to the directory `fromDir`.
 * Both paths are slash-separated and may share a common prefix.
 */
export function relativeAssetPath(fromDir: string, toFile: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = toFile.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const ups = from.length - i;
  return [...new Array(ups).fill(".."), ...to.slice(i)].join("/") || ".";
}

/** Downloads an asset into a Buffer; throws on a non-OK response. */
export async function downloadAsset(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
