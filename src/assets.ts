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
  // "." and ".." are directory references, not filenames; committing them
  // would either fail or escape the per-problem image directory.
  return cleaned === "" || /^\.+$/.test(cleaned) ? "asset" : cleaned;
}

/**
 * Rewrites asset URLs in HTML to local paths. Simple per-URL string
 * replacement — safe because the map keys are exact attribute values.
 * Longer URLs are replaced first so a URL that is a prefix of another (e.g.
 * `a.png` and `a.png?x=1`) cannot partially rewrite the longer one.
 */
export function rewriteAssetUrls(
  html: string,
  map: ReadonlyMap<string, string>
): string {
  let out = html;
  const entries = [...map].sort(([a], [b]) => b.length - a.length);
  for (const [url, path] of entries) {
    out = out.split(url).join(path);
  }
  return out;
}

/**
 * Builds an asset's repo-relative storage path, omitting empty segments so an
 * empty prefix/destination (files at the repo root) never produces a leading
 * slash.
 */
export function assetStoragePath(
  prefix: string,
  slug: string,
  filename: string
): string {
  return [prefix, "images", slug, filename]
    .filter((part) => part !== "")
    .join("/");
}

/**
 * Resolves how a downloaded asset is referenced in output files. References
 * are repo-root-absolute (`/...`):
 * - `assets` empty (`""`): the full storage path, e.g. storage
 *   `solutions/images/<slug>/<file>` → `/solutions/images/<slug>/<file>`.
 * - `assets` set (e.g. `"static"`): the value is the storage root and is
 *   stripped, e.g. `static/images/<slug>/<file>` → `/images/<slug>/<file>`.
 * If the storage path does not start with the value, the whole path is used.
 */
export function assetReference(assets: string, storagePath: string): string {
  const prefix = assets ? `${assets}/` : "";
  const relative = storagePath.startsWith(prefix)
    ? storagePath.slice(prefix.length)
    : storagePath;
  return `/${relative}`;
}

/** Downloads an asset into a Buffer; throws on a non-OK response. */
export async function downloadAsset(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
