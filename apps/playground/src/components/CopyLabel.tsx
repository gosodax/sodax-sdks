/** The tick a finished action wears, here and on the confirm dialog's completed swap. */
export function CheckGlyph() {
  return (
    <svg className="copied-glyph" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * A copy button's label and its confirmation, held in one grid cell so the button is as wide as the
 * wider of the two and never resizes mid-press. Only the visible state reaches the accessible name.
 */
export function CopyLabel({ label, copied }: { label: string; copied: boolean }) {
  return (
    <span className={copied ? 'copy-label copy-label-copied' : 'copy-label'}>
      <span className="copy-label-idle">{label}</span>
      <span className="copy-label-done">
        <CheckGlyph /> Copied
      </span>
    </span>
  );
}
