import { useEffect, useRef } from "react";

// Moves keyboard focus to an element when it mounts, as a replacement for the
// autoFocus prop (banned by jsx-a11y/no-autofocus). Use only for elements that
// appear in direct response to a user action — an inline rename field, a search
// box revealed on click, a dialog's primary input — where focusing the new
// element is the expected, predictable behaviour and does not steal focus on
// initial page load.
export function useFocusOnMount<ElementType extends HTMLElement>() {
  const ref = useRef<ElementType>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
