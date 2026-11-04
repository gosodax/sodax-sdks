import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  isOracleCandleInterval,
  useBackendOracleCandles,
  useBackendOracleMarkets,
  type OracleCandleInterval,
} from '@sodax/dapp-kit';
import { CandlestickChart, RefreshCw } from 'lucide-react';
import CandleChart from './CandleChart';

const CANDLE_COUNT = 100;
const DEFAULT_INTERVAL: OracleCandleInterval = '1h';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export default function OracleCandlesCard() {
  const { data: markets, isLoading: isLoadingMarkets, error: marketsError } = useBackendOracleMarkets();

  const [selectedSymbol, setSelectedSymbol] = useState<string>();
  const [interval, setSelectedInterval] = useState<OracleCandleInterval>(DEFAULT_INTERVAL);
  // Captured once per selection/refresh so `from`/`to` stay stable in the query key.
  const [windowEnd, setWindowEnd] = useState(nowSeconds);

  const handleSymbolChange = (value: string): void => {
    setSelectedSymbol(value);
    setWindowEnd(nowSeconds());
  };

  const handleIntervalChange = (value: string): void => {
    if (!isOracleCandleInterval(value)) return;
    setSelectedInterval(value);
    setWindowEnd(nowSeconds());
  };

  const intervals = useMemo(
    () => (markets?.intervals ?? []).filter(entry => isOracleCandleInterval(entry.key)),
    [markets],
  );
  const symbol = selectedSymbol ?? (markets?.symbols.includes('ETH') ? 'ETH' : markets?.symbols[0]);
  const intervalSeconds = intervals.find(entry => entry.key === interval)?.seconds;

  const params = useMemo(
    () =>
      symbol && intervalSeconds
        ? { symbol, interval, from: windowEnd - CANDLE_COUNT * intervalSeconds, to: windowEnd }
        : undefined,
    [symbol, interval, intervalSeconds, windowEnd],
  );

  const { data, isLoading: isLoadingCandles, error: candlesError } = useBackendOracleCandles({ params });

  const candles = data?.candles ?? [];
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : undefined;
  const isLoading = isLoadingMarkets || isLoadingCandles;
  const error = marketsError ?? candlesError;

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-2xl font-bold flex items-center gap-2">
          <CandlestickChart className="h-6 w-6" />
          Oracle Candles
        </CardTitle>
        <CardDescription>
          USD OHLC candles from the backend oracle API — last {CANDLE_COUNT} buckets of the selected interval.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="space-y-2">
            <Label>Symbol</Label>
            <Select value={symbol ?? ''} onValueChange={handleSymbolChange}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder={isLoadingMarkets ? 'Loading...' : 'Select symbol'} />
              </SelectTrigger>
              <SelectContent>
                {(markets?.symbols ?? []).map(marketSymbol => (
                  <SelectItem key={marketSymbol} value={marketSymbol}>
                    {marketSymbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Interval</Label>
            <Select value={interval} onValueChange={handleIntervalChange}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Select interval" />
              </SelectTrigger>
              <SelectContent>
                {intervals.map(entry => (
                  <SelectItem key={entry.key} value={entry.key}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={() => setWindowEnd(nowSeconds())} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>

        {isLoading && <Skeleton className="h-80 w-full" />}
        {!isLoading && error && (
          <div className="text-sm text-red-500 wrap-anywhere">Error loading oracle data: {error.message}</div>
        )}
        {!isLoading && !error && candles.length === 0 && (
          <div className="text-sm text-muted-foreground">No candles for this range.</div>
        )}
        {!isLoading && !error && candles.length > 0 && (
          <>
            <CandleChart candles={candles} />
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span>
                {data?.symbol}/{data?.quote}
              </span>
              {lastCandle && (
                <span className="font-medium text-foreground">
                  Last close: ${Number(lastCandle.close).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </span>
              )}
              <span>{candles.length} candles</span>
              {lastCandle?.final === false && <span className="text-amber-600">last candle still forming</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
