import { useEffect, useRef, type ReactNode } from 'react';

export function Modal({
  title,
  open,
  onClose,
  busy = false,
  bare = false,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  /** Close in the corner and nothing else: the content is its own heading. `title` still names it. */
  bare?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="widget-modal"
      aria-label={title}
      onClose={onClose}
      onCancel={event => {
        if (busy) event.preventDefault();
      }}
    >
      <header className={bare ? 'modal-header-bare' : 'row-between'}>
        {!bare && <h2>{title}</h2>}
        <button
          className={bare ? 'modal-close' : 'btn'}
          type="button"
          onClick={onClose}
          disabled={busy}
          aria-label={`Close ${title}`}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
