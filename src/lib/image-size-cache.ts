/// Shared cache of displayed image dimensions keyed by src URL.
///
/// Motivation: the edit-mode CodeMirror widget needs an accurate
/// `estimatedHeight` so the virtualised height-map for off-viewport image
/// lines doesn't underestimate and cause content to "snap" when those lines
/// scroll into view. The natural dimensions aren't knowable synchronously
/// unless the browser already has the image cached — which it usually does,
/// because view mode has just rendered the same images via `MarkdownImage`.
///
/// So view mode writes to this cache on every image load, and edit mode
/// reads from it when constructing `ImageWidget`s.
///
/// The cache lives for the lifetime of the page, which is fine: image URLs
/// are stable and there's no staleness concern.

interface CachedSize {
  naturalWidth: number;
  naturalHeight: number;
  /// The most recent *rendered* height observed for this src in the edit
  /// pane. Stored separately from natural dims so the estimate used by CM6's
  /// heightmap can match what the DOM actually measures — closing the gap
  /// between the CSS-driven layout and the approximation we do from natural
  /// dimensions.
  renderedHeight?: number;
}

const cache = new Map<string, CachedSize>();

if (typeof window !== 'undefined') {
  (window as any).__imageSizeCache = cache;
}

export function recordImageSize(src: string, naturalWidth: number, naturalHeight: number): void {
  if (!src || naturalWidth <= 0 || naturalHeight <= 0) return;
  const existing = cache.get(src);
  cache.set(src, { ...existing, naturalWidth, naturalHeight });
}

export function recordRenderedHeight(src: string, height: number): void {
  if (!src || height <= 0) return;
  const existing = cache.get(src);
  if (!existing) return;
  cache.set(src, { ...existing, renderedHeight: height });
}

export function getImageSize(src: string): CachedSize | undefined {
  return cache.get(src);
}

/// Approximate the displayed height. Prefers the most-recently observed
/// rendered height, falling back to a natural-dimension calculation against
/// the given container width, and finally returning null when we have no
/// information at all.
export function estimateDisplayedHeight(src: string, containerWidth: number): number | null {
  const size = cache.get(src);
  if (!size) return null;
  if (size.renderedHeight) return size.renderedHeight;
  if (size.naturalWidth <= containerWidth) return size.naturalHeight;
  return Math.round((size.naturalHeight * containerWidth) / size.naturalWidth);
}
