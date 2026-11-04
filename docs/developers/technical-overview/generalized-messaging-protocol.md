---
title: "Generalized Messaging Protocol"
description: >-
  Simple, secure cross-chain messaging system that lets dApps send and
  receive messages across networks reliably.
icon: tower-broadcast
---

### Contract Design

The contract manages cross-network message handling with secure verification to prevent double-processing and unauthorized access. It includes upgrade permissions for the owner, a list of trusted relayers, and event-driven logging to track each message's journey.

#### Events

The contract emits events to notify external systems about outgoing messages, helping to maintain an auditable record of cross-chain communication.

```solidity
event Message(
    uint256 indexed srcChainId,
    bytes   indexed srcAddress,
    uint256 indexed connSn,
    uint256 dstChainId,
    bytes dstAddress,
    bytes payload
);
```

#### State Variables

```solidity
address public owner;                      // Contract owner with privileges to update configurations and relayers, (how to upgrade and manage relays safely?)
address public feeHandler;                 // Contract owner with privileges to update configurations and relayers, (how to upgrade and manage relays safely?)
bytes32[] public relayers;                 // List of authorized relayers for message verification
uint256 public connSn;                      // Serial number for outgoing messages, ensuring unique identification
uint256 public chainId;                    // Chain ID of the current contract’s chain
mapping(uint256 => mapping(uint256 => bool)) public receipts; // Tracks processed messages to prevent duplication
```

* **owner**: Has authority to update contract configurations and manage authorized relayers.
* **relayers**: Holds addresses of trusted entities that validate messages, reducing single points of failure.
* **connSn**: A serial number for each message to uniquely identify and track outgoing messages.
* **nid**: Represents the network ID of this contract's chain, enabling accurate identification in cross-chain operations.
* **receipts**: Tracks processed messages per network ID to prevent repeated handling of the same message.

***

#### Fees

Fees are not coded into the contract but just accepted, that a fee has been paid is verified off chain if a fee is needed.

### Functions

#### `sendMessage`

The `sendMessage` function is responsible for dispatching messages to a specified network and address. It assigns a unique serial number (connSn) to each outgoing message, increments the connSn, and emits an event to signal the message dispatch.

```solidity
function sendMessage(uint256 dstChainId, bytes dstAddress, bytes memory payload) external payable {
    connSn++;
    feeHandler.transfer(msg.value);
    emit Message(connSn, chainID, msg.sender, dstChainId, dstAddress, payload);
}
```

**Parameters**

* **dstChainId**: The Chain ID of the destination network.
* **dstAddress**: The target address on the destination network.
* **payload**: The message payload to be transmitted.

***

#### `verifyMessage`

The `verifyMessage` function validates incoming messages using signatures provided by authorized relayers. It checks the `receipts` mapping to prevent processing the same message multiple times, and invokes `verifySignatures` to authenticate the message’s integrity.

```solidity
function verifyMessage(
    uint256 srcChainId,
    bytes calldata srcAddress,
    uint256 connSn,
    bytes memory payload,
    bytes[] calldata signatures
) external {
    require(!receipts[originChainId][connSn], "Message already processed");

    // Mark the message as processed to prevent re-processing
    receipts[originChainId][connSn] = true;

    // Verify the signatures to confirm authenticity
    require(
        verifySignatures(connSn, originChainId, originAddress, nid, msg.sender, payload, signatures),
        "Invalid signatures"
    );
}
```

***

### Example DApp: Using ICON GMP for Cross-Chain Messaging

#### Sending Messages

DApps can initiate cross-chain messages using `sendMessage` in the connection contract. This allows a DApp to send a signed message to a target contract on another network, which the relayers can then verify and forward to the destination network.

```solidity
function gmpAction() external {
    // Application logic here
    gmp.sendMessage(targetNetworkID, targetAddress, messagePayload);
}
```

#### Receiving Messages

SODAX GMP provides relayers to automatically submit messages to the designated `recvMessage` endpoint. This endpoint will verify the message’s authenticity using `verifyMessage` and then process it according to application-specific logic.

```solidity
function recvMessage(
    uint256 srcChainId,
    bytes calldata srcAddress,
    uint256 connSn,
    bytes memory payload,
    bytes[] calldata signatures
) external {
    // Verify the incoming message
    gmp.verifyMessage(srcChainId, srcAddress, connSn, payload, signatures);
 
    // Application-specific logic to handle the message
}
```

#### Alternative Message Consumption

In cases where a message requires special handling (e.g., error resolution or rollback), DApps can implement alternative message interfaces. This allows for customized message processing, including recovery mechanisms or other error-handling strategies.

```solidity
function revertInterface(
    uint256 srcChainId,
    bytes calldata srcAddress,
    uint256 _onnSn,
    bytes memory payload,
    bytes[] calldata signatures
) external {
    // Verify the message authenticity before proceeding
    gmp.verifyMessage(srcChainId, srcAddress, connSn, payload, signatures);

    // Implement revert or recovery logic here for special handling
}
```

### Encoding Compliance
