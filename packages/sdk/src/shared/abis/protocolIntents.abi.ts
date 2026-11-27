export const ProtocolIntentsAbi = [
  {
    type: 'function',
    name: 'setAutoSwapPreferences',
    inputs: [
      {
        name: 'outputToken',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'dstChain',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'dstAddress',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createIntentAutoSwap',
    inputs: [
      {
        name: 'user',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'fromToken',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'minOutputAmount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAutoSwapPreferences',
    inputs: [
      {
        name: 'user',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct AutoSwapPreferences',
        components: [
          {
            name: 'outputToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'dstChain',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'dstAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cancelIntent',
    inputs: [
      {
        name: 'fromToken',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'toToken',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getUserIntent',
    inputs: [
      {
        name: 'user',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'fromToken',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'toToken',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: 'intentHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getIntentDetails',
    inputs: [
      {
        name: 'intentHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'intent',
        type: 'tuple',
        internalType: 'struct Intents.Intent',
        components: [
          {
            name: 'intentId',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'creator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'inputToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'outputToken',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'inputAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'minOutputAmount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'deadline',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'allowPartialFill',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'srcChain',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'dstChain',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'srcAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'dstAddress',
            type: 'bytes',
            internalType: 'bytes',
          },
          {
            name: 'solver',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'data',
            type: 'bytes',
            internalType: 'bytes',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;
