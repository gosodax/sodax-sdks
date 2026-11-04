/**
 * The `sodax.com/exchange` app-title lockup: a bold word, an accent word in Shrikhand, and the
 * reach underneath. Both counts come from the token list the pickers offer, so the claim on screen
 * and the assets a visitor can actually pick can never disagree.
 */
export function Lockup({ assetCount, networkCount }: { assetCount: number; networkCount: number }) {
  return (
    <div className="lockup">
      <h2 className="lockup-title">
        Swap <em>everywhere</em>
      </h2>
      <p className="lockup-subtitle">
        {assetCount > 0 ? `Live quotes for ${assetCount} assets across ${networkCount} networks.` : 'Loading assets…'}
      </p>
    </div>
  );
}
