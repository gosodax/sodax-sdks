import React from 'react';
import './App.css';

import { createBrowserRouter, Outlet, RouterProvider, Navigate } from 'react-router';
import { ChainKeys } from '@sodax/dapp-kit';
import Header from './components/shared/header';
import SwapsSdkPage from './pages/swaps-sdk/page';
import SwapsApiPage from './pages/swaps-api/page';
import MoneyMarketPage from './pages/money-market/page';
import BridgePage from './pages/bridge/page';
import BridgeApiPage from './pages/bridge-api/page';
import DexPage from './pages/dex/page';
import StakingPage from './pages/staking/page';
import PartnerFeeClaimPage from './pages/partner-fee-claim/page';
import RecoveryPage from './pages/recovery/page';
import LeverageYieldPage from './pages/leverage-yield/page';
import LeverageYieldApiPage from './pages/leverage-yield-api/page';
import LeveragePositionsPage from './pages/leverage-positions/page';
import OraclePage from './pages/oracle/page';
import { ROUTES } from './constants';

const router = createBrowserRouter([
  {
    path: '/',
    element: (
      <>
        <Header />
        <Outlet />
      </>
    ),
    children: [
      {
        path: '/',
        element: <Navigate to={ROUTES.SWAPS_SDK} replace />,
      },
      {
        // Legacy path kept as a literal: it is history, not a current route. The demo is deployed, so
        // existing bookmarks and shared links to the old swaps page must keep working.
        path: '/solver',
        element: <Navigate to={ROUTES.SWAPS_SDK} replace />,
      },
      {
        path: ROUTES.SWAPS_SDK,
        element: <SwapsSdkPage />,
      },
      {
        path: ROUTES.SWAPS_API,
        element: <SwapsApiPage />,
      },
      {
        path: ROUTES.MONEY_MARKET,
        element: <Navigate to={`${ROUTES.MONEY_MARKET}/${ChainKeys.ARBITRUM_MAINNET}`} replace />,
      },
      {
        path: `${ROUTES.MONEY_MARKET}/:chainId`,
        element: <MoneyMarketPage />,
      },
      {
        path: ROUTES.BRIDGE,
        element: <BridgePage />,
      },
      {
        path: ROUTES.BRIDGE_API,
        element: <BridgeApiPage />,
      },
      {
        path: ROUTES.DEX,
        element: <DexPage />,
      },
      {
        path: ROUTES.STAKING,
        element: <StakingPage />,
      },
      {
        path: ROUTES.PARTNER_FEE_CLAIM,
        element: <PartnerFeeClaimPage />,
      },
      {
        path: ROUTES.RECOVERY,
        element: <RecoveryPage />,
      },
      {
        path: ROUTES.LEVERAGE_YIELD,
        element: <LeverageYieldPage />,
      },
      {
        path: ROUTES.LEVERAGE_YIELD_API,
        element: <LeverageYieldApiPage />,
      },
      {
        path: ROUTES.LEVERAGE_POSITIONS,
        element: <LeveragePositionsPage />,
      },
      {
        path: ROUTES.ORACLE,
        element: <OraclePage />,
      },
      {
        path: '*',
        element: <Navigate to={ROUTES.SWAPS_SDK} replace />,
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

export default App;
