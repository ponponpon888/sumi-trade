export interface TokenPolicy {
  symbol: string;
  label: string;
  contractAddress: string;
}

export const TOKEN_POLICIES: TokenPolicy[] = [
  {
    symbol: "SHIB",
    label: "Shiba Inu",
    contractAddress: "0x00000000000000000000000000000000000000d3",
  },
  {
    symbol: "BONK",
    label: "Bonk (Ethereum)",
    contractAddress: "0x1151CB3d861920e07a38e03eEAd12C32178567F6",
  },
  {
    symbol: "WLD",
    label: "Worldcoin",
    contractAddress: "0x163f8C2467924be0ae7B5347228CABF260318753",
  },
  {
    symbol: "FLOKI",
    label: "FLOKI",
    contractAddress: "0xcf0C122c6b73ff809C693DB761e7BaeBe62b6a2E",
  },
  {
    symbol: "STRUMP",
    label: "Super Trump",
    contractAddress: "0x00000000000000000000000000000000000000d4",
  },
  {
    symbol: "LADYS",
    label: "Milady Meme Coin",
    contractAddress: "0x12970E6868f88f6557B76120662c1B3E50A646bf",
  },
  {
    symbol: "PEPE",
    label: "Pepe",
    contractAddress: "0x6982508145454Ce325dDbE47a25d4ec3d2311933",
  },
  {
    symbol: "PALM",
    label: "PaLM AI",
    contractAddress: "0x00000000000000000000000000000000000000d5",
  },
];

export const TOKEN_POLICY_BY_ADDRESS = new Map(
  TOKEN_POLICIES.map((policy) => [policy.contractAddress.toLowerCase(), policy]),
);
