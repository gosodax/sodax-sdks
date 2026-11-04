---
title: "Hub Wallet Abstraction"
description: >-
  Deterministic wallet proxies on the Hub chain give every connected-chain
  user a corresponding hub wallet, enabling cross-chain operations without
  exposing the underlying complexity.
icon: wallet
---

### Architecture

#### Core Components

1. **WalletFactory (Beacon Proxy)**
   * Manages the creation and tracking of user wallets
   * Uses CREATE3 for deterministic deployments
   * Implements upgradeable proxy pattern for future improvements
   * Maps any (chainId, userAddress) pair to a unique Hub chain wallet address
2. **Wallet Implementation**
   * Handles cross-chain message execution
   * Manages permissions through specialized hooks
   * Executes arbitrary contract calls on behalf of users

#### How It Works

1. **Wallet Creation**

```solidity:evm/contracts/wallet/walletfactory.sol
function getWallet(uint256 chainId, bytes calldata user) external returns (address computedAddress) {
    bytes32 salt = keccak256(abi.encodePacked(address(this), chainId, user));
    computedAddress = CREATE3.getDeployed(salt);
    if (computedAddress.code.length <= 0) {
        this.deploy(salt);
    }
    return computedAddress;
}
```

* When a user first interacts with the system, a deterministic wallet is created
* The wallet address is derived from the user's origin chain ID and address
* CREATE3 ensures the same wallet address is always generated for a given user

2. **Cross-Chain Interaction**

```solidity:evm/contracts/wallet/wallet.sol
function recvMessage(
    uint256 srcChainId,
    bytes calldata srcAddress,
    uint256 _connSn,
    bytes memory _payload,
    bytes[] calldata signatures
) external {
    connection.verifyMessage(srcChainId, srcAddress, _connSn, _payload, signatures);
    require(
        address(this) == factory.getWallet(originChainId, originAddress),
        "Mismatched address and caller"
    );
    executeCalls(payload);
}
```

* Users send messages from their origin chain
* Messages are verified through the connection contract
* The wallet executes the requested actions on the Hub chain

3. **Specialized Access**

* **Asset Manager Hook**: Allows asset manager to execute on behalf of the user
* **XToken Manager Hook**: Allows XToken manager to execute on behalf of the user

### Hashed Calls

In order to support spoke chains with limited call data size, we support hashed calls.

When a user sends a message to the Hub chain, the message of length 32 bytes it will be treated as keccak256 hashed data and stored in the wallet.

When the user wants to execute the stored call, they can call the `executeStored` function with the same data. This will generallay be handled by the relayer.

This allows the user to store a call on the Hub chain and execute it later on the spoke chain.

### Key Features

1. **Deterministic Addressing**
   * Every user gets a predictable wallet address on the Hub chain
   * No need for explicit wallet deployment transactions
   * Gas-efficient through CREATE3
2. **Upgradeable Architecture**
   * Beacon proxy pattern allows wallet implementation upgrades
   * All user wallets can be upgraded simultaneously
   * Maintains consistent addresses across upgrades
3. **Flexible Execution**
   * Supports arbitrary contract calls
   * Batched transactions through ContractCall structs
   * Secure permission system for different operation types

### Use Cases

#### Example: Cross-Chain Money Market Interaction

1. User initiates action from their origin chain
2. Message is verified and routed to their Hub wallet
3. Wallet executes complex operations (e.g., deposit, borrow, withdraw)
4. Results can be bridged back to any desired chain

#### Future Extensions

The system is designed to support future enhancements such as:

* Multi-wallet linking across chains
* Customizable security parameters
* Signature-based operations without cross-chain messages
* Rate limiting and additional security features
* Adding more specialized hooks for systems such as LayerZero

### Security Considerations

* All cross-chain messages must be properly verified
* Only authorized contracts (AssetManager) can access specialized hooks
* Wallet addresses are deterministically generated to prevent conflicts
* Upgrades are controlled by the factory owner through UUPS pattern

### Asset Manager Integration Showcase

#### How Asset Manager Access Works

1. **Cross-Chain Asset Transfer Reception**

```solidity:evm/contracts/assetmanager/assetmanager.sol
function recvMessage(
    uint256 nonce,
    uint256 srcChainId,
    bytes calldata fromAddress,
    bytes memory payload,
    bytes[] memory signatures
) external {
    // Verify the sender is the authorized asset manager for the source chain
    require(keccak256(fromAddress) == keccak256(spokeAssetManager[srcChainId]));
    
    // Verify the cross-chain message
    connection.(srcChainId, fromAddress, noncepayload, signatures);

    Transfer memory _transfer = payload.decode();

    // Mint tokens to the recipient
    address token = assets[srcChainId][_transfer.token];
    IAssetToken(token).mintTo(_transfer.to.toAddress(), _transfer.amount);

    // If additional actions are needed, call the user's wallet
    if (_transfer.data.length > 0) {
        address wallet = walletFactory.getWallet(srcChainId, _transfer.from);
        IWallet(wallet).assetManagerHook(_transfer.data);
    }
}
```

2. **Wallet Hook Execution**

```solidity:evm/contracts/wallet/wallet.sol
function assetManagerHook(bytes memory data) external {
    // Only the authorized AssetManager can call this function
    require(msg.sender == assetManager, "Only AssetManager is allowed");

    // Execute the calls described in the data
    executeCalls(data);
}
```

#### Asset Manager Flow

1. **Initial Transfer**
   * User initiates a cross-chain transfer from the source chain
   * Transfer includes optional additional actions (encoded in `data`)
2. **Hub Chain Processing**
   * AssetManager receives and verifies the cross-chain message
   * Mints corresponding tokens on the Hub chain
   * If additional actions are specified:
     * Locates the user's wallet using WalletFactory
     * Calls the wallet's assetManagerHook with the specified actions
3. **Security Measures**
   * Only the authorized AssetManager contract can call the wallet's hook
   * Messages must come from authorized spoke AssetManagers
   * All cross-chain messages are verified through the connection contract

#### Example Use Case: Transfer and Stake

```solidity
// Example of transfer data that includes staking action
Transfer {
    token: "0x...", // Source chain token address
    from: userAddress,
    to: hubWalletAddress,
    amount: 1000,
    data: abi.encode([
        ContractCall({
            addr: STAKING_CONTRACT,
            value: 0,
            data: abi.encodeWithSignature("stake(uint256)", 1000)
        })
    ])
}
```

This transfer would:

1. Move tokens from the source chain to the Hub chain
2. Mint tokens to the user's Hub wallet
3. Automatically stake the tokens through the wallet's assetManagerHook

#### Security Considerations

* Only the designated AssetManager contract can invoke the assetManagerHook
* Cross-chain messages must come from authorized spoke AssetManagers
* All operations are executed in the context of the user's wallet
* The hook system prevents unauthorized access to wallet functions
* Asset transfers and subsequent actions are atomic (they either all succeed or all fail)
