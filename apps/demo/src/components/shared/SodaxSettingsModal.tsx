import React, { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DEFAULT_API_BASE_URL, DEFAULT_RELAYER_API_ENDPOINT } from '@sodax/dapp-kit';
import { SolverEnv, useAppStore } from '@/zustand/useAppStore';
import { defaultUseBackendSubmitTx, productionSolverConfig, stagingSolverConfig } from '@/constants';
import {
  DEFAULT_BRIDGE_API_BASE_URL,
  envBridgeApiBaseUrl,
  envLeverageYieldApiBaseUrl,
  envPrivyAppId,
  envSodaxApiKey,
  envSwapsApiBaseUrl,
  bpsToPercentText,
  isEvmAddress,
  isHttpUrl,
  MAX_PARTNER_FEE_PERCENT,
  partnerFeePercentError,
  percentTextToBps,
  type SodaxSettings,
} from '@/lib/sodaxSettings';
import { Check, Copy, Eye, EyeOff, RotateCcw } from 'lucide-react';

type SubmitTxChoice = 'auto' | 'on' | 'off';

const URL_FIELDS = [
  'solverApiEndpoint',
  'apiBaseUrl',
  'swapsApiBaseUrl',
  'bridgeApiBaseUrl',
  'leverageYieldApiBaseUrl',
  'relayerApiEndpoint',
] as const;
const ADDRESS_FIELDS = ['intentsContract', 'protocolIntentsContract', 'partnerFeeAddress'] as const;
/** Fields whose unset default is the effective gateway — see `defaultsFor`. */
const GATEWAY_INHERITED_FIELDS = ['swapsApiBaseUrl', 'leverageYieldApiBaseUrl'] as const;
const TEXT_FIELDS = [
  ...URL_FIELDS,
  ...ADDRESS_FIELDS,
  'partnerFeePercent',
  'apiKey',
  'leverageYieldApiKey',
  'privyAppId',
] as const;

type TextField = (typeof TEXT_FIELDS)[number];

/** Modal draft: the text fields hold the EFFECTIVE value (default prefilled, copyable). */
type Draft = {
  env: SolverEnv;
  swapUseBackendSubmitTx: SubmitTxChoice;
  bridgeUseBackendSubmitTx: SubmitTxChoice;
  leverageYieldUseBackendSubmitTx: SubmitTxChoice;
} & Record<TextField, string>;

/** The effective default text per field — what an unset override resolves to. `gatewayUrl` is
 *  the effective gateway, which unset swaps inherit (`resolveSwapsApiConfig` layering). */
function defaultsFor(env: SolverEnv, gatewayUrl: string = DEFAULT_API_BASE_URL): Record<TextField, string> {
  const solver = env === SolverEnv.Staging ? stagingSolverConfig : productionSolverConfig;
  return {
    solverApiEndpoint: solver.solverApiEndpoint,
    intentsContract: solver.intentsContract,
    protocolIntentsContract: solver.protocolIntentsContract,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    swapsApiBaseUrl: envSwapsApiBaseUrl ?? gatewayUrl,
    bridgeApiBaseUrl: envBridgeApiBaseUrl ?? DEFAULT_BRIDGE_API_BASE_URL,
    // Unlike bridge's canary default, the leverage-yield API rides the gateway, same as swaps.
    leverageYieldApiBaseUrl: envLeverageYieldApiBaseUrl ?? gatewayUrl,
    // Unset means the action inherits the instance key below.
    leverageYieldApiKey: '',
    // The demo ships no partner fee: unset means the SDK charges nothing.
    partnerFeeAddress: '',
    partnerFeePercent: '',
    // Deliberately NOT `envSodaxApiKey`: prefilling would print the deployment's key into the
    // modal, a tooltip and the clipboard. Empty means "inherit it", which the hint says out loud.
    apiKey: '',
    relayerApiEndpoint: DEFAULT_RELAYER_API_ENDPOINT,
    // A Privy app id is public (it ships in the bundle), so unlike the API key it is prefilled.
    privyAppId: envPrivyAppId ?? '',
  };
}

/** The gateway a draft (or stored override) actually resolves to. */
function effectiveGateway(apiBaseUrl: string | null): string {
  const trimmed = apiBaseUrl?.trim() ?? '';
  return isHttpUrl(trimmed) ? trimmed : DEFAULT_API_BASE_URL;
}

function seedDraft(env: SolverEnv, s: SodaxSettings): Draft {
  const defaults = defaultsFor(env, effectiveGateway(s.apiBaseUrl));
  return {
    env,
    swapUseBackendSubmitTx: s.swapUseBackendSubmitTx === null ? 'auto' : s.swapUseBackendSubmitTx ? 'on' : 'off',
    bridgeUseBackendSubmitTx: s.bridgeUseBackendSubmitTx === null ? 'auto' : s.bridgeUseBackendSubmitTx ? 'on' : 'off',
    leverageYieldUseBackendSubmitTx:
      s.leverageYieldUseBackendSubmitTx === null ? 'auto' : s.leverageYieldUseBackendSubmitTx ? 'on' : 'off',
    solverApiEndpoint: s.solverApiEndpoint ?? defaults.solverApiEndpoint,
    intentsContract: s.intentsContract ?? defaults.intentsContract,
    protocolIntentsContract: s.protocolIntentsContract ?? defaults.protocolIntentsContract,
    apiBaseUrl: s.apiBaseUrl ?? defaults.apiBaseUrl,
    swapsApiBaseUrl: s.swapsApiBaseUrl ?? defaults.swapsApiBaseUrl,
    bridgeApiBaseUrl: s.bridgeApiBaseUrl ?? defaults.bridgeApiBaseUrl,
    leverageYieldApiBaseUrl: s.leverageYieldApiBaseUrl ?? defaults.leverageYieldApiBaseUrl,
    leverageYieldApiKey: s.leverageYieldApiKey ?? defaults.leverageYieldApiKey,
    partnerFeeAddress: s.partnerFeeAddress ?? defaults.partnerFeeAddress,
    partnerFeePercent: s.partnerFeeBps === null ? defaults.partnerFeePercent : bpsToPercentText(s.partnerFeeBps),
    apiKey: s.apiKey ?? defaults.apiKey,
    relayerApiEndpoint: s.relayerApiEndpoint ?? defaults.relayerApiEndpoint,
    privyAppId: s.privyAppId ?? defaults.privyAppId,
  };
}

type FieldErrors = Partial<Record<TextField, string>>;

function validateDraft(draft: Draft): FieldErrors {
  const errors: FieldErrors = {};
  for (const field of URL_FIELDS) {
    const value = draft[field].trim();
    if (value && !isHttpUrl(value)) {
      errors[field] = 'Must be an http(s) URL';
    }
  }
  for (const field of ADDRESS_FIELDS) {
    const value = draft[field].trim();
    if (value && !isEvmAddress(value)) {
      errors[field] = 'Must be a 0x-prefixed 20-byte address';
    }
  }
  // The SDK `fee` is a single object, so a lone address or a lone rate can't be expressed.
  const feeAddress = draft.partnerFeeAddress.trim();
  const feePercent = draft.partnerFeePercent.trim();
  const feePercentError = partnerFeePercentError(feePercent);
  if (feePercentError) {
    errors.partnerFeePercent = feePercentError;
  } else if (feePercent && !feeAddress) {
    errors.partnerFeeAddress = 'Required when a fee rate is set';
  } else if (feeAddress && !feePercent) {
    errors.partnerFeePercent = 'Required when a fee address is set';
  }
  return errors;
}

/** Empty, or equal to the effective default → null (unset, keeps following defaults); else an override. */
function draftToSettings(draft: Draft): SodaxSettings {
  const defaults = defaultsFor(draft.env, effectiveGateway(draft.apiBaseUrl));
  const norm = (field: TextField): string | null => {
    const value = draft[field].trim();
    return value && value !== defaults[field] ? value : null;
  };
  const url = (field: (typeof URL_FIELDS)[number]) => {
    const value = norm(field);
    return value !== null && isHttpUrl(value) ? value : null;
  };
  const address = (field: (typeof ADDRESS_FIELDS)[number]) => {
    const value = norm(field);
    return value !== null && isEvmAddress(value) ? value : null;
  };
  return {
    swapUseBackendSubmitTx: draft.swapUseBackendSubmitTx === 'auto' ? null : draft.swapUseBackendSubmitTx === 'on',
    bridgeUseBackendSubmitTx:
      draft.bridgeUseBackendSubmitTx === 'auto' ? null : draft.bridgeUseBackendSubmitTx === 'on',
    leverageYieldUseBackendSubmitTx:
      draft.leverageYieldUseBackendSubmitTx === 'auto' ? null : draft.leverageYieldUseBackendSubmitTx === 'on',
    solverApiEndpoint: url('solverApiEndpoint'),
    intentsContract: address('intentsContract'),
    protocolIntentsContract: address('protocolIntentsContract'),
    apiBaseUrl: url('apiBaseUrl'),
    swapsApiBaseUrl: url('swapsApiBaseUrl'),
    bridgeApiBaseUrl: url('bridgeApiBaseUrl'),
    leverageYieldApiBaseUrl: url('leverageYieldApiBaseUrl'),
    leverageYieldApiKey: norm('leverageYieldApiKey'),
    apiKey: norm('apiKey'),
    relayerApiEndpoint: url('relayerApiEndpoint'),
    partnerFeeAddress: address('partnerFeeAddress'),
    partnerFeeBps: percentTextToBps(draft.partnerFeePercent),
    privyAppId: norm('privyAppId'),
  };
}

/** Auto keys on the EFFECTIVE solver endpoint — a custom/staging endpoint means the production
 *  backend can't reach that solver, whatever the env tab says. */
function effectiveSolverEndpoint(draft: Draft): string {
  return draft.solverApiEndpoint.trim() || defaultsFor(draft.env).solverApiEndpoint;
}

function submitTxChoiceToBoolean(choice: SubmitTxChoice, autoValue: boolean): boolean {
  return choice === 'auto' ? autoValue : choice === 'on';
}

/** Effective-config snapshot for pasting into a bug report; the API key is masked. */
function draftToDebugJson(draft: Draft): string {
  const swapBackendSubmitTx = defaultUseBackendSubmitTx(effectiveSolverEndpoint(draft));
  return JSON.stringify(
    {
      swapSolverEnvironment: draft.env,
      swapSubmitTxMode: draft.swapUseBackendSubmitTx,
      swapUseBackendSubmitTx: submitTxChoiceToBoolean(draft.swapUseBackendSubmitTx, swapBackendSubmitTx),
      bridgeSubmitTxMode: draft.bridgeUseBackendSubmitTx,
      bridgeUseBackendSubmitTx: submitTxChoiceToBoolean(draft.bridgeUseBackendSubmitTx, true),
      leverageYieldSubmitTxMode: draft.leverageYieldUseBackendSubmitTx,
      leverageYieldUseBackendSubmitTx: submitTxChoiceToBoolean(
        draft.leverageYieldUseBackendSubmitTx,
        // Same Auto rule as swap, so the same computed value.
        swapBackendSubmitTx,
      ),
      solverApiEndpoint: draft.solverApiEndpoint.trim(),
      intentsContract: draft.intentsContract.trim(),
      protocolIntentsContract: draft.protocolIntentsContract.trim(),
      apiBaseUrl: draft.apiBaseUrl.trim(),
      swapsApiBaseUrl: draft.swapsApiBaseUrl.trim(),
      bridgeApiBaseUrl: draft.bridgeApiBaseUrl.trim(),
      leverageYieldApiBaseUrl: draft.leverageYieldApiBaseUrl.trim(),
      leverageYieldApiKey: draft.leverageYieldApiKey.trim() ? '(set)' : '(unset)',
      partnerFeeAddress: draft.partnerFeeAddress.trim() || '(unset)',
      // The percent is the input unit; bps is what the SDK and both APIs actually receive.
      partnerFeeBps: percentTextToBps(draft.partnerFeePercent) ?? '(unset)',
      apiKey: draft.apiKey.trim() ? '(set)' : '(unset)',
      relayerApiEndpoint: draft.relayerApiEndpoint.trim(),
      privyAppId: draft.privyAppId.trim() || '(unset)',
    },
    null,
    2,
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable (permissions/insecure context) — nothing to do
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="h-9 w-9 shrink-0"
      onClick={copy}
      disabled={!text}
      title={label}
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </Button>
  );
}

/**
 * Label · input · copy — with an amber ring and a ↺ reset button while overriding the default.
 * `secret` masks the value until the eye is clicked, and keeps it out of the reset tooltip: a key
 * belongs in the request, not on a screen being shared.
 */
function TextRow({
  label,
  value,
  defaultValue,
  error,
  hint,
  secret = false,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  defaultValue: string;
  error?: string;
  hint?: ReactNode;
  secret?: boolean;
  /** What an empty field means — a masked row is otherwise indistinguishable from an unset one. */
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const modified = value.trim() !== defaultValue;
  return (
    <div className="grid sm:grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-1">
      <Label className="text-sm font-medium">
        {label}
        {modified && <span className="ml-1.5 align-middle inline-block w-1.5 h-1.5 bg-amber-400 rounded-full" />}
      </Label>
      <div className="flex items-center gap-1.5 min-w-0">
        <Input
          value={value}
          type={secret && !revealed ? 'password' : 'text'}
          placeholder={placeholder}
          autoComplete={secret ? 'off' : undefined}
          onChange={e => onChange(e.target.value)}
          className={`h-9 font-mono flex-1 min-w-0 ${modified ? 'border-amber-400' : ''}`}
        />
        {secret && value.trim() !== '' && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setRevealed(r => !r)}
            title={revealed ? `Hide ${label}` : `Reveal ${label}`}
          >
            {revealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
        )}
        {modified && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => onChange(defaultValue)}
            title={secret || !defaultValue ? 'Reset to default' : `Reset to default: ${defaultValue}`}
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
        )}
        <CopyButton text={value.trim()} label={`Copy ${label}`} />
      </div>
      {(error || hint) && (
        <div className={`sm:col-start-2 text-xs ${error ? 'text-red-500' : 'text-muted-foreground'}`}>
          {error ?? hint}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1.5 mt-1">
      {children}
    </h4>
  );
}

function SubmitTxRow({
  label,
  value,
  autoEnabled,
  warning,
  hint,
  onText,
  offText,
  onChange,
}: {
  label: string;
  value: SubmitTxChoice;
  autoEnabled: boolean;
  warning?: ReactNode;
  hint: ReactNode;
  onText: string;
  offText: string;
  onChange: (value: SubmitTxChoice) => void;
}) {
  return (
    <div className="grid sm:grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-1">
      <Label className="text-sm font-medium">
        {label}
        {value !== 'auto' && (
          <span className="ml-1.5 align-middle inline-block w-1.5 h-1.5 bg-amber-400 rounded-full" />
        )}
      </Label>
      <Select value={value} onValueChange={next => onChange(next as SubmitTxChoice)}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">Auto (currently {autoEnabled ? 'on' : 'off'})</SelectItem>
          <SelectItem value="on">{onText}</SelectItem>
          <SelectItem value="off">{offText}</SelectItem>
        </SelectContent>
      </Select>
      <div className={`sm:col-start-2 text-xs ${warning ? 'text-amber-600' : 'text-muted-foreground'}`}>
        {warning ?? hint}
      </div>
    </div>
  );
}

export function SodaxSettingsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { solverEnvironment, sodaxSettings, applySodaxSettings } = useAppStore();
  const [draft, setDraft] = useState<Draft>(() => seedDraft(solverEnvironment, sodaxSettings));

  // Re-seed from the store every time the modal opens, so Cancel/ESC never leaks a stale draft.
  useEffect(() => {
    if (open) {
      setDraft(seedDraft(useAppStore.getState().solverEnvironment, useAppStore.getState().sodaxSettings));
    }
  }, [open]);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const hasErrors = Object.keys(errors).length > 0;

  const defaults = defaultsFor(draft.env, effectiveGateway(draft.apiBaseUrl));
  const swapAutoSubmitTx = defaultUseBackendSubmitTx(effectiveSolverEndpoint(draft));
  const bridgeAutoSubmitTx = true;
  const swapSubmitTxMismatch = draft.swapUseBackendSubmitTx === 'on' && !swapAutoSubmitTx;
  // A vault swap is a solver intent posted through the swaps pipeline, so it inherits swap's Auto
  // rule and swap's staging mismatch — not bridge's unconditional on.
  const leverageYieldAutoSubmitTx = swapAutoSubmitTx;
  const leverageYieldSubmitTxMismatch = draft.leverageYieldUseBackendSubmitTx === 'on' && !leverageYieldAutoSubmitTx;
  // What the per-action row falls back to: the typed instance key, or the env one behind it.
  const inheritedApiKey = draft.apiKey.trim() !== '' || Boolean(envSodaxApiKey);

  // Show the basis points the percent resolves to — that is the number the SDK and both APIs get.
  const feeBps = percentTextToBps(draft.partnerFeePercent);
  const feePercentHint =
    feeBps === null
      ? `Percent of the input — 0.1 = 0.1%, max ${MAX_PARTNER_FEE_PERCENT}%. Set it together with the fee address.`
      : `= ${feeBps} bps. Set it together with the fee address.`;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(prev => ({ ...prev, [key]: value }));

  // Untouched fields (still showing the old env's default) follow the new env's default.
  const handleEnvChange = (env: SolverEnv) => {
    setDraft(prev => {
      const gateway = effectiveGateway(prev.apiBaseUrl);
      const prevDefaults = defaultsFor(prev.env, gateway);
      const nextDefaults = defaultsFor(env, gateway);
      const next = { ...prev, env };
      for (const field of TEXT_FIELDS) {
        if (prev[field].trim() === prevDefaults[field]) {
          next[field] = nextDefaults[field];
        }
      }
      return next;
    });
  };

  // A gateway-inherited URL still at its default follows the new gateway instead of becoming an
  // explicit override pinned to the old one.
  const handleGatewayChange = (apiBaseUrl: string) => {
    setDraft(prev => {
      const next = { ...prev, apiBaseUrl };
      const prevDefaults = defaultsFor(prev.env, effectiveGateway(prev.apiBaseUrl));
      const nextDefaults = defaultsFor(prev.env, effectiveGateway(apiBaseUrl));
      for (const field of GATEWAY_INHERITED_FIELDS) {
        if (prev[field].trim() === prevDefaults[field]) {
          next[field] = nextDefaults[field];
        }
      }
      return next;
    });
  };

  const handleSave = () => {
    if (hasErrors) return;
    const next = draftToSettings(draft);
    applySodaxSettings(draft.env, next);
    // The wallet config is read once at start-up (`index.tsx`), so a new Privy app id needs a fresh page.
    if (next.privyAppId !== sodaxSettings.privyAppId) {
      window.location.reload();
      return;
    }
    onOpenChange(false);
  };

  const handleReset = () => {
    setDraft(prev => ({
      ...prev,
      swapUseBackendSubmitTx: 'auto',
      bridgeUseBackendSubmitTx: 'auto',
      leverageYieldUseBackendSubmitTx: 'auto',
      ...defaultsFor(prev.env),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85dvh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 sm:px-6 pt-5 pb-3 border-b">
          <DialogTitle>Sodax Settings</DialogTitle>
          <DialogDescription>
            Feature-aware SDK and API config, ready to copy. Edit a value to override it — equal to its default (or
            cleared) keeps following its env var or packaged default.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 flex flex-col gap-3">
          <SectionTitle>Swap SDK</SectionTitle>

          <div className="grid sm:grid-cols-[10rem_1fr] items-center gap-x-3 gap-y-1">
            <Label className="text-sm font-medium">Solver env</Label>
            <Tabs value={draft.env} onValueChange={value => handleEnvChange(value as SolverEnv)}>
              <TabsList>
                <TabsTrigger value={SolverEnv.Staging}>Staging</TabsTrigger>
                <TabsTrigger value={SolverEnv.Production}>Production</TabsTrigger>
              </TabsList>
            </Tabs>
            <p className="sm:col-start-2 text-xs text-muted-foreground">
              A swap-only preset: it swaps the solver endpoint below and nothing else. Both presets share the same
              contracts.
            </p>
          </div>

          <SubmitTxRow
            label="Submit-tx"
            value={draft.swapUseBackendSubmitTx}
            autoEnabled={swapAutoSubmitTx}
            warning={
              swapSubmitTxMismatch
                ? 'Backend submit posts to the production swaps API — the selected solver never sees the intent and its /status stays NOT_FOUND.'
                : undefined
            }
            hint="Used by the Swap SDK page. On: swaps API relays + post-executes. Off: client calls /execute on the solver below."
            onText="On — backend submit via swaps API"
            offText="Off — client-side relay to the solver"
            onChange={value => set('swapUseBackendSubmitTx', value)}
          />
          <TextRow
            label="Solver API endpoint"
            value={draft.solverApiEndpoint}
            defaultValue={defaults.solverApiEndpoint}
            error={errors.solverApiEndpoint}
            hint="Used by Swap SDK quotes, /execute and solver /status. Bridge does not use the solver."
            onChange={value => set('solverApiEndpoint', value)}
          />
          <TextRow
            label="Intents contract"
            value={draft.intentsContract}
            defaultValue={defaults.intentsContract}
            error={errors.intentsContract}
            hint="Hub contract the Swap SDK approves and sends createIntent/cancelIntent to. Point it elsewhere only with a solver that watches that contract."
            onChange={value => set('intentsContract', value)}
          />

          <SectionTitle>Bridge SDK</SectionTitle>

          <p className="text-xs text-muted-foreground">
            Bridge has no staging preset and never reads the solver config — it runs against production whatever the
            swap solver env above is set to.
          </p>

          <SubmitTxRow
            label="Submit-tx"
            value={draft.bridgeUseBackendSubmitTx}
            autoEnabled={bridgeAutoSubmitTx}
            hint="Used by the Bridge SDK page. Auto follows the SDK default (on)."
            onText="On — backend submit via gateway"
            offText="Off — client-side relay"
            onChange={value => set('bridgeUseBackendSubmitTx', value)}
          />
          <TextRow
            label="Bridge API base URL"
            value={draft.bridgeApiBaseUrl}
            defaultValue={defaults.bridgeApiBaseUrl}
            error={errors.bridgeApiBaseUrl}
            hint="Used by the Bridge API page only — override it for a custom bridge-api deployment. Bridge SDK calls follow the gateway below."
            onChange={value => set('bridgeApiBaseUrl', value)}
          />

          <SectionTitle>Leverage Yield SDK</SectionTitle>

          <p className="text-xs text-muted-foreground">
            Vault deposits and withdrawals on the Leverage Yield page. A vault swap is a solver intent, so it follows
            the swap solver env above — leverage positions are a separate on-chain flow and ignore this row.
          </p>

          <SubmitTxRow
            label="Submit-tx"
            value={draft.leverageYieldUseBackendSubmitTx}
            autoEnabled={leverageYieldAutoSubmitTx}
            warning={
              leverageYieldSubmitTxMismatch
                ? 'Backend submit posts to the production leverage-yield API, which runs the production swaps pipeline — the selected solver never sees the intent and its /status stays NOT_FOUND.'
                : undefined
            }
            hint="Used by the Leverage Yield page. On: leverage-yield API relays + post-executes. Off: client-side relay, then /execute on the solver above. Auto follows the swap rule (off on Staging)."
            onText="On — backend submit via leverage-yield API"
            offText="Off — client-side relay to the solver"
            onChange={value => set('leverageYieldUseBackendSubmitTx', value)}
          />

          <TextRow
            label="Leverage Yield action API key"
            value={draft.leverageYieldApiKey}
            defaultValue={defaults.leverageYieldApiKey}
            error={errors.leverageYieldApiKey}
            secret
            placeholder={inheritedApiKey ? 'Inheriting the instance key — hidden' : 'Not set'}
            hint="Per-action `extras.apiKey` for the Leverage Yield page's vault swap — keys the submit POST and its status polls over the instance key. Unset inherits that key. The client-side relay path sends none."
            onChange={value => set('leverageYieldApiKey', value)}
          />

          <TextRow
            label="Leverage Yield API base URL"
            value={draft.leverageYieldApiBaseUrl}
            defaultValue={defaults.leverageYieldApiBaseUrl}
            error={errors.leverageYieldApiBaseUrl}
            hint="Used by the Leverage Yield API page only — override it for a local leverage-yield API. The Leverage Yield SDK page follows the gateway below."
            onChange={value => set('leverageYieldApiBaseUrl', value)}
          />

          <SectionTitle>Partner fee</SectionTitle>

          <p className="text-xs text-muted-foreground">
            The global SDK fee, applied to Swap SDK, Bridge SDK, money market and leverage yield. A per-call or
            per-feature fee still wins over it, and the Swaps API / Bridge API pages send their own per-request fee
            instead — this does not reach them.
          </p>

          <TextRow
            label="Fee address"
            value={draft.partnerFeeAddress}
            defaultValue={defaults.partnerFeeAddress}
            error={errors.partnerFeeAddress}
            hint="Recipient of the fee. Unset (the demo default) means SDK flows charge nothing."
            onChange={value => set('partnerFeeAddress', value)}
          />
          <TextRow
            label="Fee (%)"
            value={draft.partnerFeePercent}
            defaultValue={defaults.partnerFeePercent}
            error={errors.partnerFeePercent}
            hint={feePercentHint}
            onChange={value => set('partnerFeePercent', value)}
          />
          <TextRow
            label="Protocol intents"
            value={draft.protocolIntentsContract}
            defaultValue={defaults.protocolIntentsContract}
            error={errors.protocolIntentsContract}
            hint="Used by the Partner fee claim page only — claim, withdraw and cancel target it. Not part of the swap flow."
            onChange={value => set('protocolIntentsContract', value)}
          />

          <SectionTitle>API endpoints</SectionTitle>

          <TextRow
            label="Gateway base URL"
            value={draft.apiBaseUrl}
            defaultValue={defaults.apiBaseUrl}
            error={errors.apiBaseUrl}
            hint="Used by SDK data routes and Bridge SDK backend submit-tx. Swaps can override below; sponsoring stays env-only."
            onChange={handleGatewayChange}
          />
          <TextRow
            label="Swaps API base URL"
            value={draft.swapsApiBaseUrl}
            defaultValue={defaults.swapsApiBaseUrl}
            error={errors.swapsApiBaseUrl}
            hint="Used by Swap API page and Swap SDK backend submit-tx. At its default it follows VITE_SWAPS_API_BASE_URL / gateway."
            onChange={value => set('swapsApiBaseUrl', value)}
          />
          <TextRow
            label="API key"
            value={draft.apiKey}
            defaultValue={defaults.apiKey}
            secret
            placeholder={envSodaxApiKey ? 'Set by VITE_SODAX_API_KEY — hidden' : 'Not set'}
            hint={
              envSodaxApiKey
                ? 'x-api-key on every backend call. Left empty it inherits VITE_SODAX_API_KEY, which is never shown here.'
                : 'x-api-key on every backend call. Keys typed here live in this browser only.'
            }
            onChange={value => set('apiKey', value)}
          />
          <TextRow
            label="Relayer endpoint"
            value={draft.relayerApiEndpoint}
            defaultValue={defaults.relayerApiEndpoint}
            error={errors.relayerApiEndpoint}
            hint="Used by Swap SDK / Bridge SDK client-side relay when submit-tx is Off."
            onChange={value => set('relayerApiEndpoint', value)}
          />

          <SectionTitle>Wallet</SectionTitle>

          <TextRow
            label="Privy app id"
            value={draft.privyAppId}
            defaultValue={defaults.privyAppId}
            placeholder={envPrivyAppId ? 'Empty uses VITE_PRIVY_APP_ID' : 'Not set — no Email (Privy)'}
            hint={`Adds "Email (Privy)" to the EVM wallet list. Allow ${window.location.origin} in the Privy dashboard. Saving a change reloads the page.`}
            onChange={value => set('privyAppId', value)}
          />
        </div>

        <div className="px-4 sm:px-6 py-4 border-t flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CopyButtonWithLabel text={draftToDebugJson(draft)} />
              <Button variant="outline" size="sm" onClick={handleReset}>
                Reset all
              </Button>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button variant="cherry" size="sm" onClick={handleSave} disabled={hasErrors}>
                Save
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-right">
            Saving re-creates the SDK instance and clears cached queries.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** "Copy JSON" with the same copied feedback as the per-field button. */
function CopyButtonWithLabel({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — nothing to do
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} title="Copy the effective config as JSON">
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
      Copy JSON
    </Button>
  );
}
