---
title: "Intents"
description: >-
  Cross-chain execution infrastructure where users express a desired outcome
  on the hub chain and solvers fulfill it from any supported spoke chain.
icon: bullseye
---

The system consists of two main contracts:

1. **Intents Contract (Hub)** - The central coordinator that:
   * Manages intent creation and lifecycle
   * Handles settlement of trades
   * Coordinates cross-chain communication
   * Maintains the source of truth for all intents
2. **IntentFiller Contract (Spokes)** - Deployed on spoke chains to:
   * Enable local fulfillment of intents
   * Lock solver funds during cross-chain settlement
   * Relay fill confirmations back to the hub

### Core Architecture

#### Centralized Settlement

All intent logic and final settlement occurs on the hub chain. This design choice provides several benefits:

* Single source of truth for intent status
* Simplified accounting and settlement
* Reduced cross-chain complexity
* Atomic execution of trades

#### Spoke Chain Role

Spoke chains serve as execution venues that:

* Allow solvers to fill intents directly on destination chains
* Provide faster user experience by avoiding cross-chain delays
* Act as temporary fund escrow for cross-chain settlements
* Do not maintain any intent state - they only facilitate fills

#### Flow Example

1. User creates intent on hub chain
2. Solver sees intent and locks funds on spoke chain
3. Spoke chain notifies hub of the fill attempt
4. Hub validates and settles the trade
5. Hub notifies spoke to release funds to user
6. Solver receives payment on hub chain

This architecture ensures that while execution can happen anywhere, settlement and intent state management remain centralized on the hub chain, simplifying the system while maintaining security and atomicity.

## Intents System - Data Structures and Events

### Intent Structure

The core `Intent` structure represents a user's trading desire with the following fields:

```solidity
struct Intent {
    uint256 intentId;        // Unique identifier for the intent
    address creator;         // Address that created the intent
    address inputToken;      // Token the user is providing
    address outputToken;     // Token the user wants to receive
    uint256 inputAmount;     // Amount of input tokens
    uint256 minOutputAmount; // Minimum amount of output tokens to accept
    uint256 deadline;        // Optional timestamp after which intent expires (0 = no deadline)
    bool allowPartialFill;   // Whether the intent can be partially filled
    uint256 srcChain;       // Chain ID where input tokens originate
    uint256 dstChain;       // Chain ID where output tokens should be delivered
    bytes srcAddress;       // Source address in bytes (for cross-chain compatibility)
    bytes dstAddress;       // Destination address in bytes (for cross-chain compatibility)
    address solver;         // Optional specific solver address (address(0) = any solver)
    bytes data;            // Additional arbitrary data
}
```

### Events

#### Intent Lifecycle Events

```solidity
event IntentCreated(
    bytes32 intentHash,    // Hash of the intent for unique identification
    Intent intent          // Full intent details
);

event IntentFilled(
    bytes32 intentHash,    // Hash of the intent
    IntentState intentState // Current state after fill
);

event IntentCancelled(
    bytes32 intentHash     // Hash of the cancelled intent
);

event ExternalFillFailed(
    uint256 fillId,        // ID of the failed cross-chain fill
    ExternalFill fill      // Details of the failed fill
);
```

### Supporting Structures

#### IntentState

Tracks the current state of an intent:

```solidity
struct IntentState {
    bool exists;           // Whether the intent exists
    uint256 remainingInput;// Amount of input tokens still to be filled
    uint256 receivedOutput;// Amount of output tokens received so far
    bool pendingPayment;   // Whether there are pending payments to solvers
}
```

#### PendingIntentState

Tracks cross-chain fills in progress:

```solidity
struct PendingIntentState {
    uint256 pendingInput;  // Amount of input tokens locked in pending fills
    uint256 pendingOutput; // Amount of output tokens expected from pending fills
}
```

#### ExternalFill

Records details of cross-chain fills:

```solidity
struct ExternalFill {
    bytes32 intentHash;    // Hash of the intent being filled
    address to;            // Solver address to receive payment
    address token;         // Token to pay the solver
    uint256 inputAmount;   // Amount of input tokens being filled
    uint256 outputAmount;  // Amount of output tokens promised
}
```

#### Payout

Tracks pending payments to solvers:

```solidity
struct Payout {
    address solver;        // Address of the solver
    uint256 amount;        // Amount to be paid
}
```

## Intents System - Function Interface

### Hub Chain (Intents Contract)

#### Intent Management

```solidity
function createIntent(Intent calldata intent) external
```

Creates a new intent and transfers input tokens from the creator.

* `intent`: The complete intent specification
* Emits: `IntentCreated`
* Requirements:
  * `inputAmount` must be > 0
  * Input tokens must be approved to contract

```solidity
function cancelIntent(Intent calldata intent) external
```

Cancels an existing intent and returns remaining input tokens.

* `intent`: The intent to cancel
* Emits: `IntentCancelled`
* Requirements:
  * Intent must exist
  * Caller must be creator OR deadline must have passed
  * No pending fills can exist

#### Fill Operations

```solidity
function fillIntent(
    Intent calldata intent,
    uint256 _inputAmount,
    uint256 _outputAmount,
    uint256 _externalFillId
) external
```

Fills an intent either partially or fully.

* `intent`: The intent to fill
* `_inputAmount`: Amount of input tokens to consume
* `_outputAmount`: Amount of output tokens to provide
* `_externalFillId`: ID for cross-chain fills (0 for hub-chain)
* Requirements:
  * Intent must exist and not be pending payment
  * Fill amount must be valid
  * Output amount must meet minimum requirements
  * Solver restrictions must be met

```solidity
function preFillIntent(
    Intent calldata intent,
    uint256 _inputAmount,
    uint256 _outputAmount,
    uint256 _externalFillId
) external
```

Pre-fills an intent before input tokens are received.

* Similar to `fillIntent` but creates intent if it doesn't exist
* Marks intent as pending payment
* Used for optimistic filling scenarios

#### Administrative Functions

```solidity
function addSpoke(
    uint256 chainID,
    bytes memory spokeAddress
) external onlyOwner
```

Registers a spoke chain filler contract.

* `chainID`: Chain ID of the spoke
* `spokeAddress`: Address of the IntentFiller contract on spoke chain

```solidity
function setWhitelistedSolver(
    address solver,
    bool whitelisted
) external onlyOwner
```

Manages solver whitelist for cross-chain fills.

* `solver`: Address of the solver
* `whitelisted`: Whether solver is approved

### Spoke Chain (IntentFiller Contract)

This section will be implemented by the spoke chain and thus wont be exactly the same as the EVM implementation.

#### Fill Data Structure

The `Fill` struct is the core data structure used to represent fill attempts on spoke chains:

```solidity
struct Fill {
    uint256 fillID;        // Unique identifier for the cross-chain fill
    bytes intentHash;      // Hash of the intent being filled (in bytes for cross-chain compatibility)
    bytes solver;          // Solver's address in bytes format
    bytes receiver;        // Recipient's address in bytes format
    bytes token;          // Token address in bytes format
    uint256 amount;       // Amount of tokens being transferred
}
```

#### Field Details:

* `fillID`:
  * Unique identifier generated by the solver
  * Used to track the fill across chains
  * Must be unique per intent-solver combination
  * Used to prevent double-fills
* `intentHash`:
  * The keccak256 hash of the original intent from the hub
  * Stored in bytes format for cross-chain compatibility
  * Used to link the fill to the original intent
* `solver`:
  * Address of the solving entity in bytes format
  * Will receive payment on the hub chain upon successful fill
  * Cross-chain format allows for different address formats across chains
* `receiver`:
  * Destination address for the filled tokens
  * Matches the `dstAddress` from the original intent
  * Stored in bytes for cross-chain compatibility
* `token`:
  * Address of the token being transferred
  * Stored in bytes format for cross-chain compatibility
  * Can be the zero address (represented in bytes) for native currency
* `amount`:
  * Quantity of tokens being transferred

#### Fill Operations

```solidity
function fillIntent(Fill memory fill) external payable
```

Creates a new fill on spoke chain.

* `fill`: Fill details including amount and recipient
* Requirements:
  * For native token, msg.value must match fill amount
  * For ERC20, tokens must be transferred to contract

```solidity
function cancelFill(Fill memory fill) external
```

Cancels a pending fill and returns tokens.

* `fill`: Fill to cancel
* Requirements:
  * Fill must exist
  * Caller must be original filler

## Token Management and Cross-Chain Asset Handling

### Native Token Support

The Intents system supports native tokens (ETH) as both input and output tokens. Native tokens are represented by the zero address (`address(0)`) in the system.

#### Native Token Usage

1.  **As Input Token**:

    * When creating an intent with native token as input, the user must send the correct amount of ETH with the transaction
    * The amount must include both the input amount and any fees
    * Example:

    ```solidity
    // Creating an intent with 1 ETH input and 0.1 ETH fee
    FeeData memory feeData = FeeData({
        fee: 0.1 ether,
        receiver: feeReceiver
    });
    intent.inputToken = address(0);  // Native token
    intent.inputAmount = 1 ether;
    intents.createIntent{value: 1.1 ether}(intent);  // Send 1.1 ETH
    ```
2.  **As Output Token**:

    * When filling an intent with native token as output, the solver must send the correct amount of ETH with the transaction
    * The native token can only be sent to the hub chain (no cross-chain native token transfers)
    * Example:

    ```solidity
    // Filling an intent with 1 ETH output
    intent.outputToken = address(0);  // Native token
    intent.minOutputAmount = 1 ether;
    intents.fillIntent{value: 1 ether}(intent, inputAmount, 1 ether, 0);
    ```

#### Native Token Restrictions

1. **Cross-Chain Limitations**:
   * Native tokens can only be used on the hub chain
   * Cross-chain transfers of native tokens are not supported
   * When using native tokens, the `dstChain` must be set to the hub chain ID
2. **Fee Handling**:
   * Fees in native tokens work the same way as ERC20 tokens
   * The total amount sent must include both the input amount and the fee
   * Fees are distributed proportionally for partial fills

#### Examples

1. **Native to ERC20 Intent**:

```solidity
Intent memory intent = Intent({
    inputToken: address(0),  // Native token
    outputToken: erc20Token,
    inputAmount: 1 ether,
    minOutputAmount: 1000,
    dstChain: HUB_CHAIN_ID,  // Must be hub chain for native token
    // ... other fields ...
});

// Create intent with native token
intents.createIntent{value: 1.1 ether}(intent);  // Including 0.1 ETH fee
```

2. **ERC20 to Native Intent**:

```solidity
Intent memory intent = Intent({
    inputToken: erc20Token,
    outputToken: address(0),  // Native token
    inputAmount: 1000,
    minOutputAmount: 1 ether,
    dstChain: HUB_CHAIN_ID,  // Must be hub chain for native token
    // ... other fields ...
});

// Fill intent with native token
intents.fillIntent{value: 1 ether}(intent, 1000, 1 ether, 0);
```

### Token Mapping System

The system uses the `AssetManager` contract to maintain mappings between tokens across different chains. Each token has:

* A home chain (where it originates)
* A address on each chain where it exists
* A relationship with the hub chain representation

```solidity
// From AssetManager interface
function assetInfo(address token) external view returns (
    uint256 chainID,    // Home chain of the token
    bytes memory spokeAddress  // Address on home chain
);
```

### Token Transfer Logic

The hub's `sendToken` function handles all token transfers when filling an intent based on destination chain configuration:

```solidity
function sendToken(
    address token,
    uint256 dstChainID,
    bytes memory to,
    uint256 amount
) internal {
    if (amount == 0) revert InvalidAmount();
    
    (uint256 chainID, bytes memory spokeAddress) = assetManager.assetInfo(token);
    
    // Case 1: Sending to hub chain
    if (dstChainID == HUB_CHAIN_ID) {
        IERC20(token).transfer(AddressLib.toAddress(to), amount);
    } 
    // Case 2: Sending to non-home chain
    else if (dstChainID != chainID) {
        // Route through wallet factory to appropriate chain
        IERC20(token).transfer(
            walletFactory.getWallet(chainID, to), 
            amount
        );
    } 
    // Case 3: Sending to token's home chain
    else {
        assetManager.transfer(token, to, amount, "");
    }
}
```

#### Transfer Cases

1. **To Hub Chain** (dstChainID == HUB\_CHAIN\_ID):\
   When the dst in the intent is set to the hub chain, the token is transferred directly to the user.
2. **To Non-Home Chain** (dstChainID != chainID):\
   If the intent is done to a different chain than the token's home chain, the token is transferred to a wallet abstraction on the hub chain for that specific user.
3. **To Home Chain** (dstChainID == chainID):\
   If the intent is done to the token's home chain, the token is transferred directly to the user via the AssetManager.

### Token Flow Example

For a cross-chain intent where:

* Input token is native to Chain A
* Output token is native to Chain B
* Intent is created and settled on Hub Chain

The flow would be:

1. User sends tokens from Chain A to Hub
2. Solver fills the intent on the Hub Chain
3. Hub uses AssetManager to bridge directly to Chain B
4. Solver receives payment on Hub chain

### External Fill token mappings

While all intents created needs to be between tokens represented on the hub chain, when filling externally the solver must fill the correct token representation on the spoke chain. Which can be queried from the asset manager.

## Fee System

### Overview

The Intents system supports a flexible fee mechanism that allows for partner fees to be collected during intent execution. Fees are specified in the intent's data field and are handled automatically during the fill process.

### Fee Data Structure

Fees are encoded in the intent's data field using the following structure:

```solidity
struct FeeData {
    uint256 fee;          // Amount of fee in input token
    address receiver;     // Address to receive the fee
}
```

### Fee Encoding

Fees are encoded in the intent's data field with a type identifier:

```solidity
bytes data = abi.encodePacked(uint8(1), abi.encode(FeeData));
```

### Fee Collection Process

#### During Intent Creation

1. User must approve the contract for `inputAmount + fee`
2. The full amount (including fee) is transferred to the contract
3. The fee data is stored in the contract's state

#### During Fill Operations

1. For full fills:
   * The fee is sent to the fee receiver
   * The remaining amount is sent to the solver
2. For partial fills:
   * The fee is proportionally split
   * The filled portion's fee is sent to the fee receiver
   * The remaining fee is returned to the creator upon cancellation

#### During Cancellation

1. If the intent is cancelled before any fills:
   * The full fee is returned to the creator
2. If the intent is partially filled:
   * The filled portion's fee is sent to the fee receiver
   * The remaining fee is returned to the creator

### Fee Examples

#### Full Fill

```solidity
// Intent with 1 ETH input and 0.1 ETH fee
FeeData memory feeData = FeeData({
    fee: 0.1 ether,
    receiver: feeReceiver
});

// After fill:
// - Fee receiver gets 0.1 ETH
// - Solver gets 1 ETH
```

#### Partial Fill (50%)

```solidity
// Intent with 1 ETH input and 0.1 ETH fee
// After 50% fill:
// - Fee receiver gets 0.05 ETH (50% of fee)
// - Solver gets 0.5 ETH (50% of input)
// - Creator gets 0.55 ETH back (remaining input + remaining fee)
```

#### Cancellation

```solidity
// Before any fills:
// - Creator gets 1.1 ETH back (input + fee)

// After 50% fill:
// - Fee receiver keeps 0.05 ETH
// - Creator gets 0.55 ETH back
```

### Important Considerations

1. Fees are always denominated in the input token
2. The fee amount must be approved along with the input amount
3. Fees are handled automatically by the contract
4. Partial fills result in proportional fee distribution
5. Cancellation returns any unclaimed fees to the creator
