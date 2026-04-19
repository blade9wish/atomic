import { useState, useEffect, useRef, SyntheticEvent } from 'react';
import { Image as ImageIcon, AlertTriangle } from 'lucide-react';
import {
  getImageSize,
  recordImageSize,
  recordRenderedHeight,
} from '../../lib/image-size-cache';

interface MarkdownImageProps {
  src?: string;
  alt?: string;
}

export function MarkdownImage({ src, alt }: MarkdownImageProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const imgRef = useRef<HTMLImageElement | null>(null);

  const handleLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    if (src) recordImageSize(src, img.naturalWidth, img.naturalHeight);
    setStatus('loaded');
  };

  // Once the image transitions to `loaded` the React re-render positions it
  // in flow; capture its rendered height so the edit-mode CodeMirror widget
  // can seed an accurate `estimatedHeight` when the user toggles to edit.
  useEffect(() => {
    if (status !== 'loaded' || !src) return;
    const img = imgRef.current;
    if (!img) return;
    const h = img.getBoundingClientRect().height;
    if (h > 0) recordRenderedHeight(src, h);
  }, [status, src]);
  const handleError = (e: SyntheticEvent<HTMLImageElement>) => {
    setStatus('error');
    e.currentTarget.style.display = 'none';
  };

  // If we've seen this image before, reserve the actual rendered height on
  // the wrapper so the space allocated during `loading` matches the final
  // rendered size. Otherwise the image mounts at the 100px placeholder and
  // then "grows" after the load event, shifting everything below it and
  // breaking the content position we just preserved during a view↔edit
  // toggle.
  const cached = src ? getImageSize(src) : undefined;
  const wrapperStyle =
    cached?.renderedHeight && cached.renderedHeight > 100
      ? { minHeight: `${cached.renderedHeight}px` }
      : undefined;

  return (
    <span className="markdown-image-wrapper" style={wrapperStyle}>
      {status === 'loading' && (
        <span className="markdown-image-placeholder">
          <ImageIcon className="w-8 h-8 text-[var(--color-text-tertiary)]" strokeWidth={2} />
        </span>
      )}
      {status === 'error' && (
        <span className="markdown-image-error">
          <AlertTriangle className="w-6 h-6" strokeWidth={2} />
          <span>Failed to load image</span>
        </span>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt || ''}
        // Eager loading, not lazy: a typical atom has few enough images that
        // parallel download is cheap, and the "image pops in as you scroll"
        // layout shift from lazy loading was causing major misalignment when
        // toggling view↔edit. Real fix would be explicit `width`/`height`
        // attributes from stored dimensions, but eager is a good default.
        loading="eager"
        decoding="async"
        onLoad={handleLoad}
        onError={handleError}
        className={status === 'loaded' ? 'markdown-image-loaded' : 'markdown-image-loading'}
      />
    </span>
  );
}
