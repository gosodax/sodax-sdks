/** Submission may have succeeded. Use the existing operation's identifiers to recover it. */
export class IndeterminateOutcomeError<Recovery = unknown> extends Error {
  public readonly txHash?: string;
  public readonly trackingId?: string;
  public readonly recovery?: Recovery;

  constructor(message: string, options: { cause: unknown; txHash?: string; trackingId?: string; recovery?: Recovery }) {
    super(message, { cause: options.cause });
    this.name = 'IndeterminateOutcomeError';
    this.txHash = options.txHash;
    this.trackingId = options.trackingId;
    this.recovery = options.recovery;
  }
}
