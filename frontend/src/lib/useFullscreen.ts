import { useEffect, useRef, useState } from "react";

/**
 * `Element.requestFullscreen`/`Document.exitFullscreen` on Safari/iOS are
 * still exposed under their WebKit-prefixed names in the TS DOM lib. Kept to
 * narrow interfaces rather than reaching for `any` at every call site.
 */
interface FullscreenCapableElement extends HTMLElement {
  webkitRequestFullscreen?: () => void;
}
interface FullscreenCapableDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
}

/**
 * Drives fullscreen on a wrapper element -- deliberately never on a <video>
 * itself. Calling fullscreen on a video is what hands playback to the
 * browser's own native chrome (iOS's AVPlayer controls, Android's default
 * player bar), which is exactly the UI a custom control bar exists to
 * replace. A plain element going fullscreen just grows to fill the screen
 * and keeps rendering whatever's inside it, controls included.
 *
 * Pre-16.4 iOS Safari has no Fullscreen API for arbitrary elements, so this
 * also drives its own CSS-only fullscreen state (the caller applies
 * `fixed inset-0` while `isFullscreen` is true) as a guaranteed fallback --
 * that state is set regardless of whether the native API engages, so callers
 * only need to branch on the one flag.
 */
export function useElementFullscreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  function isNativeFullscreen() {
    const doc = document as FullscreenCapableDocument;
    return (
      (doc.fullscreenElement ?? null) === ref.current ||
      (doc.webkitFullscreenElement ?? null) === ref.current
    );
  }

  async function enter() {
    const el = ref.current;
    if (!el) return;
    // Applied immediately regardless of what follows: on a browser with no
    // Fullscreen API for arbitrary elements, this CSS state is the *only*
    // fullscreen there is. Where the real API is available it simply doubles
    // up with the UA's own fullscreen styling.
    setIsFullscreen(true);
    try {
      const fsEl = el as FullscreenCapableElement;
      if (fsEl.requestFullscreen) await fsEl.requestFullscreen();
      else fsEl.webkitRequestFullscreen?.();
    } catch {
      /* denied or unsupported -- the CSS fallback above already covers it */
    }
  }

  function exit() {
    if (isNativeFullscreen()) {
      const doc = document as FullscreenCapableDocument;
      if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
    }
    setIsFullscreen(false);
  }

  function toggle() {
    if (isFullscreen) exit();
    else enter();
  }

  // Catches the device's own exit gestures (swipe-down, Android back, Esc) so
  // the CSS state doesn't stay stuck on after the browser has already left
  // fullscreen.
  useEffect(() => {
    function handleChange() {
      const doc = document as FullscreenCapableDocument;
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) {
        setIsFullscreen(false);
      }
    }
    document.addEventListener("fullscreenchange", handleChange);
    document.addEventListener("webkitfullscreenchange", handleChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleChange);
      document.removeEventListener("webkitfullscreenchange", handleChange);
    };
  }, []);

  return { ref, isFullscreen, toggle };
}
