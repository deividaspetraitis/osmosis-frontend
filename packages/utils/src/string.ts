import * as cosmjsEncoding from "@cosmjs/encoding";
import * as bitcoin from "bitcoinjs-lib";
import * as viem from "viem";

/** Trucates a string with ellipsis, default breakpoint: `num = 8`. */
export function truncate(str: string, num = 8) {
  if (str.length <= num) {
    return str;
  }
  return str.slice(0, num) + "...";
}

/**
 * Shorten a string with truncation in the middle.
 * Example: `ibc/EA...25DC5`
 */
export function shorten(
  string: string,
  opts?: { prefixLength?: number; suffixLength?: number; delim?: string }
) {
  if (!string) return "";
  if (string.length <= (opts?.prefixLength ?? 6) + (opts?.suffixLength ?? 5)) {
    return string;
  }

  const prefix = string.substring(0, opts?.prefixLength ?? 6);
  const suffix = string.substring(
    string.length - (opts?.suffixLength ?? 5),
    string.length
  );

  return prefix + (opts?.delim ?? "...") + suffix;
}

export const formatICNSName = (name?: string, maxLength = 28) => {
  if (!name) return undefined;
  if (name.length <= maxLength) return name;

  const nameParts = name.split(".");
  const userName = nameParts[0];
  const chain = nameParts[1];

  return (
    userName.substring(0, 10) +
    "..." +
    userName.substring(userName.length - 5, userName.length) +
    "." +
    chain
  );
};

export const normalizeUrl = (url: string): string => {
  // Remove "https://", "http://", "www.", and trailing slashes
  url = url.replace(/^https?:\/\//, "");
  url = url.replace(/^www\./, "");
  url = url.replace(/\/$/, "");
  return url;
};

export const ellipsisText = (str: string, maxLength: number): string => {
  if (!str) return "";
  const trimmedStr = str.trim();
  if (str.length > maxLength) {
    return trimmedStr.slice(0, maxLength - 3).concat("...");
  }
  return trimmedStr;
};

export const camelCaseToSnakeCase = (input: string) => {
  return input.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
};

export function isEvmAddressValid({ address }: { address: string }): boolean {
  return viem.isAddress(address);
}

export function isBitcoinAddressValid({
  address,
  env,
}: {
  address: string;
  env: "mainnet" | "testnet";
}): boolean {
  try {
    // Attempt to decode the address
    const decoded = bitcoin.address.fromBase58Check(address);
    const isTestnet =
      decoded.version === bitcoin.networks.testnet.pubKeyHash ||
      decoded.version === bitcoin.networks.testnet.scriptHash;
    const isMainnet =
      decoded.version === bitcoin.networks.bitcoin.pubKeyHash ||
      decoded.version === bitcoin.networks.bitcoin.scriptHash;

    if ((env === "mainnet" && isMainnet) || (env === "testnet" && isTestnet)) {
      return true; // Address is valid for the given environment
    }
    return false; // Address is invalid for the given environment
  } catch (e) {
    try {
      // If Base58 decoding fails, try Bech32 decoding
      const decoded = bitcoin.address.fromBech32(address);
      const isTestnet = decoded.prefix === "tb" || decoded.prefix === "bcrt";
      const isMainnet = decoded.prefix === "bc";

      if (
        (env === "mainnet" && isMainnet) ||
        (env === "testnet" && isTestnet)
      ) {
        return true; // Address is valid for the given environment
      }
      return false; // Address is invalid for the given environment
    } catch (e) {
      return false; // Address is invalid
    }
  }
}

export function isCosmosAddressValid({
  address,
  bech32Prefix,
}: {
  address: string;
  bech32Prefix: string;
}): boolean {
  try {
    const { prefix, data } = cosmjsEncoding.fromBech32(address);
    if (prefix !== bech32Prefix) {
      return false;
    }
    return data.length === 20;
  } catch {
    return false;
  }
}

export function deriveCosmosAddress({
  address,
  desiredBech32Prefix,
}: {
  address: string;
  desiredBech32Prefix: string;
}) {
  const { data } = cosmjsEncoding.fromBech32(address);
  return cosmjsEncoding.toBech32(desiredBech32Prefix, data);
}

export function camelToKebabCase(str: string): string {
  return str
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/^-/, "");
}
