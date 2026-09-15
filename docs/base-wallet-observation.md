# Base wallet observation

`GET /api/paper/base-wallet` reads the configured Base wallet without signing or
sending a transaction. Dashboard authentication is required. The endpoint accepts
no query parameters and always responds with private, no-store cache headers.

Configure `BASE_RPC_URL` and the public `BASE_WALLET_ADDRESS`. These are separate
from the existing Ethereum scanner settings. Never put a seed phrase or private
key in either variable.

One JSON-RPC batch POST reads chain ID, latest block, native ETH balance and Base
USDC balance. The response is rejected unless the chain is Base 8453, every reply
is present exactly once, chain ID, block number, block timestamp and ETH balance
are strict JSON-RPC quantities (hexadecimal without leading zeros), the ERC-20
`balanceOf` `eth_call` return data is a 32-byte fixed-length ABI `uint256`
(`0x` followed by exactly 64 hexadecimal digits), and the latest block is at most
60 seconds old. Provider URLs and raw upstream errors are not
returned to the caller.

Successful observation removes only the uncertainty about the current public
wallet balances. It does not prove that exit gas is sufficient. L1 data fees,
token approval cost, external signer fees and execution-price quality remain
unverified, so every response stays `mode: paper`, `readiness: blocked` and
`executionLocked: true`.
