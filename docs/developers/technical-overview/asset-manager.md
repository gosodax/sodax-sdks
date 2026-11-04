---
title: "Asset Manager"
description: >-
  Hub-and-spoke asset management system for cross-network asset transfers,
  with optional execution of additional logic on transfer.
icon: boxes-stacked
---

A central Hub Asset Manager (Solidity) plus Spoke Asset Managers (any language/platform) move assets across networks and can run extra logic on transfer.

## Hub Asset Manager

### System Design

#### Core Components

The hub asset manager maintains several key components:

* **Connection Module**: Handles cross-chain message verification
* **Wallet Factory**: Generates deterministic user wallets on the hub chain
* **Asset Tokens**: Manages wrapped versions of spoke chain assets
* **Network Mappings**: Maps spoke chain asset managers and their assets

#### State Variables

```solidity:evm/contracts/assetmanager/assetmanager.sol
IConnection public connection;                    // Cross-chain messaging
IWalletFactory public walletFactory;             // User wallet management
address public assetImplementation;              // Asset token implementation
mapping(uint256 => bytes) public spokeAssetManager;  // Authorized spoke managers
mapping(uint256 => mapping(bytes => address)) public assets;  // Spoke assets to hub tokens
```

#### Transfer Data Structure

```solidity
struct Transfer {
    bytes token;      // Original token address on source chain
    bytes from;       // Sender address on source chain
    bytes to;         // Recipient address on destination chain
    uint256 amount;   // Amount to transfer
    bytes data;       // Optional execution data
}
```

#### Core Operations

1. **Receiving Cross-Chain Transfers**

```solidity:evm/contracts/assetmanager/assetmanager.sol
function recvMessage(
    uint256 nonce,
    uint256 srcChainId,
    bytes calldata srcAddress,
    bytes memory payload,
    bytes[] memory signatures
) external {
    // Verify the sender is authorized
    require(keccak256(srcAddress) == keccak256(spokeAssetManager[srcChainId]));
    
    // Verify cross-chain message
    connection.verifyMessage(srcChainId, srcAddress, payload, signatures);

    Transfer memory _transfer = payload.decode();

    // Mint wrapped tokens
    address token = assets[srcChainId][_transfer.token];
    IAssetToken(token).mintTo(_transfer.to.toAddress(), _transfer.amount);

    // Execute optional actions through user's wallet
    if (_transfer.data.length > 0) {
        address wallet = walletFactory.getWallet(srcChainId, _transfer.from);
        IWallet(wallet).assetManagerHook(_transfer.data);
    }
}
```

2. **Initiating Cross-Chain Transfers**

```solidity:evm/contracts/assetmanager/assetmanager.sol
function transfer(
    address token,
    bytes calldata to,
    uint256 amount,
    bytes calldata data
) external payable {
    // Burn wrapped tokens on hub
    AssetInfo memory info = assetInfo[token];
    IAssetToken(token).burnFrom(msg.sender, amount);

    // Construct transfer message
    Transfer memory _transfer = Transfer(
        info.spokeAddress,
        msg.sender.toBytes(),
        to,
        amount,
        data
    );

    // Send message to spoke chain
    bytes memory manager = spokeAssetManager[info.chainID];
    connection.sendMessage{value:msg.value}(
        info.chainID,
        manager,
        _transfer.encode()
    );
}
```

***

## Spoke Asset Manager Specification

### Required Implementation

Spoke chains must implement an asset manager that can:

1. Receive and verify cross-chain messages from the hub
2. Lock/unlock native assets
3. Send properly formatted messages to the hub
4. Enforce rate limits on withdrawals

#### Required Functions

1. **Receive Message**

```typescript
// Implementation language may vary
function recvMessage(
    sourceChainId: number,
    sourceAddress: Bytes,
    connSn: number,
    payload: Bytes,
    signatures: Bytes[]
): void {
    // 1. Verify message is from hub
    // 2. Decode transfer data
    // 3. Verify withdrawal is within rate limits
    // 4. Release locked tokens to recipient
    // 5. Execute any additional logic in data
}
```

2. **Send Transfer**

```typescript
// Implementation language may vary
function transfer(
    token: Address,
    recipient: Bytes,
    amount: BigInt,
    data: Bytes
): void {
    // 1. Lock tokens
    // 2. Construct transfer message
    // 3. Send message to hub
}
```

### Security Considerations

1. **Hub Chain**

* Only authorized spoke managers can send messages
* Asset tokens must be properly wrapped/unwrapped
* Wallet hooks must be properly validated

2. **Spoke Chains**

* Must verify messages come from hub
* Must properly lock/unlock native assets
* Must implement proper access controls
* Must enforce rate limits on withdrawals
* Must use consistent function naming (recvMessage)

3. **Cross-Chain**

* Asset mappings must be carefully managed
* Withdrawal limits must be properly configured and enforced
