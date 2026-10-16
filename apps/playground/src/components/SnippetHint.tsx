import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { tooltipPosition } from '../lib/tooltip';

const HINT = 'Exports the defaults in Setup. Addresses and decimals come from the SODAX swaps API';

export function SnippetHint() {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof tooltipPosition>>();

  const show = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const leave = () => {
    closeTimer.current = setTimeout(() => {
      if (document.activeElement !== trigger.current) setOpen(false);
    }, 120);
  };

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = trigger.current;
      const content = bubble.current;
      if (anchor && content)
        setPosition(
          tooltipPosition(anchor.getBoundingClientRect(), content.getBoundingClientRect(), window.innerWidth),
        );
    };
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    update();
    const observer = new ResizeObserver(update);
    if (bubble.current) observer.observe(bubble.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    window.addEventListener('keydown', dismiss);
    return () => {
      clearTimeout(closeTimer.current);
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('keydown', dismiss);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="hint-trigger"
        aria-label="About this snippet"
        aria-describedby={open ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={leave}
        onFocus={show}
        onBlur={() => setOpen(false)}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
      </button>
      {open &&
        createPortal(
          <span
            ref={bubble}
            id={id}
            className="hint-bubble"
            role="tooltip"
            data-side={position?.side}
            style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}
            onMouseEnter={show}
            onMouseLeave={leave}
          >
            {HINT}
            <svg
              className="hint-arrow"
              style={{ left: position?.arrowLeft }}
              width="16"
              height="40"
              viewBox="0 0 16 80"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M4.76995e-07 40C3.92926e-07 38.125 0.941131 37.1741 1.88235 36.6667C11.1437 31.6736 16 18.033 16 -1.90798e-07L16 80C16 61.967 11.1437 48.3264 1.88235 43.3333C0.941131 42.8259 5.61065e-07 41.875 4.76995e-07 40Z"
              />
            </svg>
          </span>,
          document.body,
        )}
    </>
  );
}
