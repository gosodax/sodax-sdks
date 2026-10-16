---
title: "Vault Token"
description: >-
  A single token that wraps multiple chain-native variants of the same
  underlying asset (e.g. USDC from different chains) into one unified position.
icon: vault
---

### Core Features

1. **Multi-Asset Support**
   * Supports multiple underlying tokens
   * Configurable deposit limits per token
   * Decimal normalization for different token standards
   * Fee mechanisms for deposits and withdrawals
2. **Rate Limiting**
   * Built-in rate limiting for all transfers
   * Consults rate limiter for mints, burns, and transfers
   * Ensures controlled token movement

### Token Configuration

#### Token Info Structure

```solidity
struct TokenInfo {
    uint8 decimals;      // Decimals of the underlying token
    uint256 depositFee;  // Fee in basis points (e.g., 50 = 0.5%)
    uint256 withdrawalFee; // Fee in basis points
    uint256 maxDeposit;  // Maximum allowable deposit
    bool isSupported;    // Whether the token is supported
}
```

#### Core Operations

1. **Deposits**

```solidity
function deposit(address token, uint256 amount) external {
    // 1. Verify token is supported
    // 2. Check deposit limits
    // 3. Transfer underlying token to vault
    // 4. Apply deposit fee if configured
    // 5. Mint vault tokens to user
}
```

2. **Withdrawals**

```solidity
function withdraw(address token, uint256 amount) external {
    // 1. Burn vault tokens from user
    // 2. Apply withdrawal fee if configured
    // 3. Transfer underlying token to user
}
```

3. **Rate-Limited Transfers**

```solidity
function _update(address from, address to, uint256 value) internal override {
    // Consult rate limiter before any transfer
    rateLimits.update(from, to, value, totalSupply());
    super._update(from, to, value);
}
```

### Security Features

1. **Deposit Controls**
   * Maximum deposit limits per token
   * Rate limiting on all transfers
   * Decimal normalization for safety
2. **Access Control**
   * Owner-controlled token configuration
   * Protected fee recipient updates
   * Restricted token support management
3. **Fee Management**
   * Configurable deposit/withdrawal fees
   * Protected fee collection mechanism
   * Fee recipient management

### Use Cases

1. **Asset Unification**
   * Wrap USDC from multiple chains into a single vault token
   * Simplify cross-chain asset management
   * Enable unified liquidity pools
2. **Fee Generation**
   * Collect fees on deposits/withdrawals
   * Generate revenue from cross-chain movements
   * Incentivize liquidity provision
3. **Rate-Limited Transfers**
   * Control token velocity
   * Prevent large sudden movements
   * Enhance security through movement restrictions
4. **Cross chain token managment**
   * Controls movement and accounting for tokens deployed across multiple chains

### Configuration Methods

```solidity
// Add support for a new underlying token
function addSupportedToken(
    address token,
    uint8 decimals,
    uint256 depositFee,
    uint256 withdrawalFee,
    uint256 maxDeposit
) external onlyOwner;
```

```solidity
// Add liqudity for a new crosschain token
function depositAndBurn(address token, uint256 amount) external;
```

// Update existing token configuration\
function updateToken(\
address token,\
uint256 depositFee,\
uint256 withdrawalFee,\
uint256 maxDeposit\
) external onlyOwner;

````

## Query Methods

```solidity
// Get vault reserves for all supported tokens
function getVaultReserves() external view returns (
    address[] memory tokens,
    uint256[] memory balances
);

// Get complete token configuration and balances
function getAllTokenInfo() external view returns (
    address[] memory tokens,
    TokenInfo[] memory infos,
    uint256[] memory reserves
);
````
