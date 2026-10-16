import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { StateCreator } from 'zustand';
import { ChainKeys, type SpokeChainKey } from '@sodax/dapp-kit';
import { loadSodaxSettings, loadStoredSolverEnv, saveSodaxSettings, type SodaxSettings } from '@/lib/sodaxSettings';

export const DEFAULT_SELECTED_CHAIN = ChainKeys.ARBITRUM_MAINNET;

export enum SolverEnv {
  Production = 'Production',
  Staging = 'Staging',
}

type AppStore = {
  selectedChainId: SpokeChainKey;
  selectChainId: (chainId: SpokeChainKey) => void;
  isWalletModalOpen: boolean;
  openWalletModal: () => void;
  closeWalletModal: () => void;
  solverEnvironment: SolverEnv;
  setSolverEnvironment: (env: SolverEnv) => void;
  sodaxSettings: SodaxSettings;
  applySodaxSettings: (env: SolverEnv, settings: SodaxSettings) => void;
};

export const useAppStore = create<AppStore>()(
  immer((set, get) => ({
    selectedChainId: ChainKeys.ARBITRUM_MAINNET,
    selectChainId: (chainId: SpokeChainKey) => set({ selectedChainId: chainId }),
    isWalletModalOpen: false,
    openWalletModal: () => set({ isWalletModalOpen: true }),
    closeWalletModal: () => set({ isWalletModalOpen: false }),
    // Env + settings persist together under one key so the modal's Save is a single write.
    solverEnvironment: loadStoredSolverEnv() === 'Staging' ? SolverEnv.Staging : SolverEnv.Production,
    setSolverEnvironment: (env: SolverEnv) => {
      saveSodaxSettings(env, get().sodaxSettings);
      set({ solverEnvironment: env });
    },
    sodaxSettings: loadSodaxSettings(),
    applySodaxSettings: (env: SolverEnv, settings: SodaxSettings) => {
      saveSodaxSettings(env, settings);
      set({ solverEnvironment: env, sodaxSettings: settings });
    },
  })) as StateCreator<AppStore, [], []>,
);
