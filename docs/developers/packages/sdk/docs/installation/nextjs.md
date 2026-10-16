---
title: "Installing @sodax/sdk with Next.js"
icon: download
generatedFrom: packages/sdk/docs/installation/nextjs.md
---

This guide will walk you through setting up `@sodax/sdk` in a Next.js project, from project creation to using the SDK features.

## Prerequisites

- Node.js 18+ installed
- npm, yarn, or pnpm package manager
- Basic knowledge of Next.js and TypeScript

## Step 1: Create Your Project

First, create a new Next.js project with TypeScript:

```bash
# Using create-next-app (recommended)
npx create-next-app@latest my-sodax-app --typescript --tailwind --eslint

# Or using yarn
yarn create next-app my-sodax-app --typescript --tailwind --eslint

# Or using pnpm
pnpm create next-app my-sodax-app --typescript --tailwind --eslint
```

Navigate to your project directory:

```bash
cd my-sodax-app
```

## Step 2: Install @sodax/sdk

Install the SODAX SDK and its peer dependencies:

```bash
# Using npm
npm install @sodax/sdk @sodax/types viem

# Using yarn
yarn add @sodax/sdk @sodax/types viem

# Using pnpm
pnpm add @sodax/sdk @sodax/types viem
```

## Step 3: Create Sodax Instance


Create a Sodax instance provider. Create `providers/SodaxProvider.tsx`:

```typescript
// providers/SodaxProvider.tsx
'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Sodax } from '@sodax/sdk';

// Create Sodax instance
const sodaxInstance = new Sodax();

// Create context
const SodaxContext = createContext<Sodax | null>(null);

// Provider component
export function SodaxProvider({ children }: { children: ReactNode }) {
  return (
    <SodaxContext.Provider value={sodaxInstance}>
      {children}
    </SodaxContext.Provider>
  );
}

// Hook to use Sodax instance
export function useSodax() {
  const context = useContext(SodaxContext);
  if (!context) {
    throw new Error('useSodax must be used within a SodaxProvider');
  }
  return context;
}
```

Update your `app/layout.tsx` to include the SodaxProvider:

```typescript
// app/layout.tsx
import { SodaxProvider } from '@/providers/SodaxProvider';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SodaxProvider>
          {children}
        </SodaxProvider>
      </body>
    </html>
  );
}
```

`SodaxProvider.tsx` is a `'use client'` module, so everything in it ships to the browser. Do not pass
it an `apiKey` — renaming `SODAX_API_KEY` to `NEXT_PUBLIC_SODAX_API_KEY` publishes the key in your bundle.
Keep keyed calls in a Server Action or Route Handler, or proxy them — see [API key good practices](https://docs.sodax.com/developers/how-to/api-key-good-practices).

## Step 4: Start Your Build Process

Start the development server:

```bash
# Using npm
npm run dev

# Using yarn
yarn dev

# Using pnpm
pnpm dev
```

Your Next.js application should now be running on `http://localhost:3000`.

## Step 5: Start Using @sodax/sdk

Now you can use the SODAX SDK in your components. Here's an example of how to use it:

```typescript
// app/page.tsx
'use client';

import { useSodax } from "./providers/SodaxProvider";
import { SolverIntentQuoteRequest } from "@sodax/sdk";
import { useEffect } from "react";

const payload = {
  amount: 10000000000000000000n,
  quote_type: "exact_input",
  token_dst: "0x0000000000000000000000000000000000000000",
  token_dst_blockchain_id: "0x89.polygon",
  token_src: "cx0000000000000000000000000000000000000000",
  token_src_blockchain_id: "0x1.icon",
} satisfies SolverIntentQuoteRequest

export default function Page() {
  const sodax = useSodax();

  useEffect(() => {
    const getQuote = async () => {
      const quote = await sodax.swaps.getQuote(payload);
      console.log(quote);
    }
    getQuote();
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Sodax SDK Demo</h1>
    </div>
  );
}

```


## TypeScript Configuration

Make sure your `tsconfig.json` includes the necessary paths for the `@` alias:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

## Next Steps

Now that you have `@sodax/sdk` set up in your Next.js project, you can:

1. **Explore Solver Features**: Check out the [Swaps documentation](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/swaps) for cross-chain swaps
2. **Explore Money Market Features**: Check out the [Money Market documentation](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/money_market) for lending and borrowing
3. **Set up Wallet Integration**: Implement wallet providers for the chains you want to support
4. **Add Error Handling**: Implement proper error handling for SDK operations
5. **Add Loading States**: Add loading indicators for async operations

## Troubleshooting

### Common Issues

1. **TypeScript Errors**: Make sure you have the latest version of TypeScript and that your `tsconfig.json` is properly configured.

2. **Import Errors**: Ensure all imports are using the correct paths and that the packages are properly installed.

### Next.js 16 + Turbopack: "module factory is not available"

Building a Next 16 app that imports `@sodax/sdk` used to crash at SSR prerender with:

```
Error: Module XXXXXX was instantiated because it was required from module YYYYYY,
but the module factory is not available.
```

The cause was upstream Turbopack scope-hoisting bugs in three transitive dependencies —
`@stacks/transactions` (reproducible with a bare `import { Cl } from '@stacks/transactions'` in a
fresh Next 16 app, no SODAX code involved), `@stacks/connect`, and
`@injectivelabs/wallet-ledger`.

No workaround is needed on the consumer side. Those dependencies are isolated inside
[`@sodax/libs`](https://github.com/icon-project/sodax-sdks/blob/main/packages/libs/README.md), which
sits at the bottom of the dependency chain and re-exports each one through its own pre-bundled
subpath. `@sodax/sdk`, `@sodax/wallet-sdk-core` and `@sodax/wallet-sdk-react` consume those subpaths,
so the published `dist` contains no top-level import that triggers the cycle.

If you hit this error, upgrade the `@sodax/*` packages first. A runnable regression app for the
fix — server component, client component and an automated build check — lives at
[`apps/example-next-js-16`](https://github.com/icon-project/sodax-sdks/tree/main/apps/example-next-js-16).

One consumer-side requirement remains: the Injective wallet path declares
`libsodium-wrappers-sumo` as an **optional peer dependency**, so install it in your app if you enable
Injective wallet support.

### Getting Help

If you encounter any issues:

- Check the [main SDK documentation](https://docs.sodax.com/developers/packages/foundation/sdk)
- Review the [Swaps documentation](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/swaps) for swap-related features
- Review the [Money Market documentation](https://docs.sodax.com/developers/packages/foundation/sdk/functional-modules/money_market) for lending/borrowing features
- Open an issue on the [GitHub repository](https://github.com/icon-project/sodax-sdks/issues)
- Join the [Discord community](https://discord.gg/xM2Nh4S6vN) for support