import React from 'react';
import { CoinsIcon, HandCoinsIcon, SproutIcon } from 'lucide-react';

const STEPS = [
  {
    icon: HandCoinsIcon,
    title: 'Supplied as collateral',
    text: 'The vault supplies its staking token, like weETH, to the SODAX money market.',
  },
  {
    icon: CoinsIcon,
    title: 'Borrowed against it',
    text: 'It borrows the base asset, like ETH, up to a target loan-to-value.',
  },
  {
    icon: SproutIcon,
    title: 'Staked again',
    text: 'The borrowed ETH becomes more weETH, and the loop repeats.',
  },
];

/** Static explainer of the leverage loop behind every vault. */
export function HowItWorks() {
  return (
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <h2 className="font-display text-2xl font-bold">How a leverage yield vault works</h2>
      <p className="text-sm text-muted-foreground">One deposit, looped into more staking yield.</p>
      <ol className="mt-5 grid gap-5 sm:grid-cols-3">
        {STEPS.map(({ icon: Icon, title, text }, index) => (
          <li key={title} className="flex gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
              <Icon className="size-5" />
            </span>
            <div>
              <p className="font-semibold">
                {index + 1} · {title}
              </p>
              <p className="text-sm text-muted-foreground">{text}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-sm text-muted-foreground">
        Each loop adds yield and risk: the APR can change or turn negative, and the share price can fall. The vault runs
        the loop; you hold its shares.
      </p>
    </section>
  );
}
