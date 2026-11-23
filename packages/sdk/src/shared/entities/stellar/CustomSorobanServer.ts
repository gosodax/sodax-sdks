import { type FeeBumpTransaction, rpc, type Transaction } from '@stellar/stellar-sdk';

export class CustomSorobanServer extends rpc.Server {
  private customHeaders: Record<string, string>;

  constructor(serverUrl: string, customHeaders: Record<string, string>) {
    super(serverUrl, {
      allowHttp: true,
    });
    this.customHeaders = customHeaders;
  }

  override async getNetwork(): Promise<rpc.Api.GetNetworkResponse> {
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.customHeaders,
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'getNetwork',
      }),
    };

    const response = await fetch(`${this.serverURL}`, requestOptions);
    if (!response.ok) {
      throw new Error(`HTTP error getting network! status: ${response.status}`);
    }

    return response.json().then(json => json.result);
  }

  override async simulateTransaction(tx: Transaction): Promise<rpc.Api.SimulateTransactionResponse> {
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.customHeaders,
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'simulateTransaction',
        params: {
          transaction: tx.toXDR(),
        },
      }),
    };

    const response = await fetch(`${this.serverURL}`, requestOptions);
    if (!response.ok) {
      throw new Error(`HTTP error simulating TX! status: ${response.status}`);
    }

    // Parse raw JSON-RPC payload into the discriminated union expected by callers
    return response.json().then(json => rpc.parseRawSimulation(json.result));
  }

  override async sendTransaction(tx: Transaction | FeeBumpTransaction): Promise<rpc.Api.SendTransactionResponse> {
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.customHeaders,
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'sendTransaction',
        params: {
          transaction: tx.toXDR(),
        },
      }),
    };

    const response = await fetch(`${this.serverURL}`, requestOptions);
    if (!response.ok) {
      throw new Error(`HTTP error submitting TX! status: ${response.status}`);
    }
    return response.json().then(json => json.result);
  }

  override async getTransaction(hash: string): Promise<rpc.Api.GetTransactionResponse> {
    const requestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.customHeaders,
      },
      body: JSON.stringify({
        id: 1,
        jsonrpc: '2.0',
        method: 'getTransaction',
        params: { hash },
      }),
    };

    const response = await fetch(`${this.serverURL}`, requestOptions);
    if (!response.ok) {
      throw new Error(`HTTP error getting TX! status: ${response.status}`);
    }
    return response.json().then(json => json.result);
  }
}
