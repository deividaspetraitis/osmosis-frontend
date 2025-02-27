import { CoinPrimitive } from "@osmosis-labs/keplr-stores";
import { MaybeUserAssetCoin, Orderbook } from "@osmosis-labs/server";
import { MinimalAsset } from "@osmosis-labs/types";
import { Dec } from "@osmosis-labs/unit";
import { getAssetFromAssetList } from "@osmosis-labs/utils";
import { useCallback, useMemo } from "react";

import { AssetLists } from "~/config/generated/asset-lists";
import { useFeatureFlags } from "~/hooks/use-feature-flags";
import { useSwapAsset } from "~/hooks/use-swap";
import { useStore } from "~/stores";
import { api } from "~/utils/trpc";

/**
 * Retrieves all available orderbooks for the current chain.
 * Fetch is asynchronous so a loading state is returned.
 * @returns A state including an orderbooks array and a loading boolean.
 */
const useOrderbooks = (): {
  orderbooks: Orderbook[];
  isLoading: boolean;
} => {
  const { data: orderbooks, isLoading } =
    api.edge.orderbooks.getPools.useQuery();

  return { orderbooks: orderbooks ?? [], isLoading };
};

/**
 * Retrieves all available base and quote denoms for the current chain.
 * Fetch is asynchronous so a loading state is returned.
 * @returns A state including an array of selectable base denom strings, selectable base denom assets, selectable quote assets organised by base assets in the form of an object and a loading boolean.
 */
export const useOrderbookSelectableDenoms = () => {
  const { orderbooks, isLoading } = useOrderbooks();

  const { data: selectableAssetPages } =
    api.edge.assets.getUserAssets.useInfiniteQuery(
      {},
      {
        enabled: true,
        getNextPageParam: (lastPage: any) => lastPage.nextCursor,
        initialCursor: 0,
      }
    );

  // Determine selectable base denoms from orderbooks in the form of denom strings
  const selectableBaseDenoms = useMemo(() => {
    const selectableDenoms = orderbooks.map((orderbook) => orderbook.baseDenom);
    return Array.from(new Set(selectableDenoms));
  }, [orderbooks]);
  // Map selectable asset pages to array of assets
  const selectableAssets = useMemo(() => {
    return selectableAssetPages?.pages.flatMap((page) => page.items) ?? [];
  }, [selectableAssetPages]);

  // Map selectable base asset denoms to asset objects
  const selectableBaseAssets = useMemo(
    () =>
      selectableBaseDenoms
        .map((denom) => {
          const existingAsset = selectableAssets.find(
            (asset) => asset.coinMinimalDenom === denom
          );
          if (existingAsset) {
            return existingAsset;
          }
          const asset = getAssetFromAssetList({
            coinMinimalDenom: denom,
            assetLists: AssetLists,
          });

          if (!asset) return;

          return asset;
        })
        .filter(Boolean) as (MinimalAsset & MaybeUserAssetCoin)[],
    [selectableBaseDenoms, selectableAssets]
  );
  // Create mapping between base denom strings and a string of selectable quote asset denom strings
  const selectableQuoteDenoms = useMemo(() => {
    const quoteDenoms: Record<string, (MinimalAsset & MaybeUserAssetCoin)[]> =
      {};
    selectableBaseAssets.forEach((asset) => {
      quoteDenoms[asset.coinDenom] = orderbooks
        .filter((orderbook) => {
          return orderbook.baseDenom === asset.coinMinimalDenom;
        })
        .map((orderbook) => {
          const { quoteDenom } = orderbook;

          const existingAsset = selectableAssets.find(
            (asset) => asset.coinMinimalDenom === quoteDenom
          );

          if (existingAsset) {
            return existingAsset;
          }

          const asset = getAssetFromAssetList({
            coinMinimalDenom: quoteDenom,
            assetLists: AssetLists,
          });
          if (!asset) return;

          return { ...asset, amount: undefined, usdValue: undefined };
        })
        .filter(Boolean)
        .sort((a, b) =>
          (a?.amount?.toDec() ?? new Dec(0)).gt(
            b?.amount?.toDec() ?? new Dec(0)
          )
            ? 1
            : -1
        ) as (MinimalAsset & MaybeUserAssetCoin)[];
    });
    return quoteDenoms;
  }, [selectableBaseAssets, orderbooks, selectableAssets]);

  return {
    selectableBaseDenoms,
    selectableQuoteDenoms,
    selectableBaseAssets,
    isLoading,
  };
};

/**
 * Retrieves a single orderbook by base and quote denom.
 * @param denoms An object including both the base and quote denom
 * @returns A state including info about the current orderbook and any orders the user may have on the orderbook
 */
export const useOrderbook = ({
  baseDenom,
  quoteDenom,
}: {
  baseDenom: string;
  quoteDenom: string;
}) => {
  const { accountStore } = useStore();
  const { orderbooks, isLoading: isOrderbookLoading } = useOrderbooks();
  const { data: selectableAssetPages } =
    api.edge.assets.getUserAssets.useInfiniteQuery(
      {
        userOsmoAddress: accountStore.getWallet(accountStore.osmosisChainId)
          ?.address,
        includePreview: false,
        limit: 50, // items per page
      },
      {
        enabled: true,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 0,

        // avoid blocking
        trpc: {
          context: {
            skipBatch: true,
          },
        },
      }
    );

  const selectableAssets = useMemo(
    () =>
      true
        ? selectableAssetPages?.pages.flatMap(({ items }) => items) ?? []
        : [],
    [selectableAssetPages?.pages]
  );
  const { asset: baseAsset } = useSwapAsset({
    minDenomOrSymbol: baseDenom,
    existingAssets: selectableAssets,
  });
  const { asset: quoteAsset } = useSwapAsset({
    minDenomOrSymbol: quoteDenom,
    existingAssets: selectableAssets,
  });

  const orderbook = useMemo(
    () =>
      orderbooks.find(
        (orderbook) =>
          baseAsset &&
          quoteAsset &&
          (orderbook.baseDenom === baseAsset.coinDenom ||
            orderbook.baseDenom === baseAsset.coinMinimalDenom) &&
          (orderbook.quoteDenom === quoteAsset.coinDenom ||
            orderbook.quoteDenom === quoteAsset.coinMinimalDenom)
      ),
    [orderbooks, baseAsset, quoteAsset]
  );
  const {
    makerFee,
    isLoading: isMakerFeeLoading,
    error: makerFeeError,
  } = useMakerFee({
    orderbookAddress: orderbook?.contractAddress ?? "",
  });

  const error = useMemo(() => {
    if (
      !isOrderbookLoading &&
      (!orderbook || !orderbook!.poolId || orderbook!.poolId === "")
    ) {
      return "errors.noOrderbook";
    }

    if (makerFeeError) {
      return makerFeeError?.message;
    }
  }, [orderbook, makerFeeError, isOrderbookLoading]);

  return {
    orderbook,
    poolId: orderbook?.poolId ?? "",
    contractAddress: orderbook?.contractAddress ?? "",
    makerFee,
    isMakerFeeLoading,
    isOrderbookLoading,
    error,
  };
};

/**
 * Hook to fetch the maker fee for a given orderbook.
 *
 * Queries the maker fee using the orderbook's address.
 * If the data is still loading, it returns a default value of Dec(0) for the maker fee.
 * Once the data is loaded, it returns the actual maker fee if available, or Dec(0) if not.
 * @param {string} orderbookAddress - The contract address of the orderbook.
 * @returns {Object} An object containing the maker fee and the loading state.
 */
const useMakerFee = ({ orderbookAddress }: { orderbookAddress: string }) => {
  const {
    data: makerFeeData,
    isLoading,
    error,
  } = api.edge.orderbooks.getMakerFee.useQuery(
    {
      osmoAddress: orderbookAddress,
    },
    {
      enabled: !!orderbookAddress,
    }
  );

  const makerFee = useMemo(() => {
    if (isLoading) return new Dec(0);
    return makerFeeData?.makerFee ?? new Dec(0);
  }, [isLoading, makerFeeData]);

  return {
    makerFee,
    isLoading,
    error,
  };
};

/**
 * Queries for all active orders for a given user.
 * Swaps between using SQS passthrough and a direct node query based on feature flag.
 */
const useOrdersQuery = ({
  userAddress,
  pageSize = 10,
  refetchInterval = 10000,
  filter,
}: {
  userAddress: string;
  pageSize?: number;
  refetchInterval?: number;
  filter?: "active" | "filled" | "historical" | "open";
}) => {
  const { sqsActiveOrders } = useFeatureFlags();
  const { orderbooks } = useOrderbooks();
  const addresses = orderbooks.map(({ contractAddress }) => contractAddress);
  const {
    data: sqsOrders,
    isLoading: isSQSOrdersLoading,
    fetchNextPage: fetchSQSOrdersNextPage,
    isFetching: isSQSOrdersFetching,
    isFetchingNextPage: isSQSOrdersFetchingNextPage,
    hasNextPage: hasSQSOrdersNextPage,
    refetch: refetchSQSOrders,
    isRefetching: isSQSOrdersRefetching,
  } = api.local.orderbooks.getAllOrdersSQS.useInfiniteQuery(
    {
      userOsmoAddress: userAddress,
      limit: pageSize,
      filter,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialCursor: 0,
      refetchInterval,
      cacheTime: refetchInterval,
      staleTime: refetchInterval,
      enabled: !!userAddress && addresses.length > 0 && sqsActiveOrders,
      refetchOnMount: true,
      keepPreviousData: false,
      trpc: {
        abortOnUnmount: true,
        context: {
          skipBatch: true,
        },
      },
    }
  );

  const {
    data: nodeOrders,
    isLoading: isNodeOrdersLoading,
    fetchNextPage: fetchNodeOrdersNextPage,
    isFetching: isNodeOrdersFetching,
    isFetchingNextPage: isNodeOrdersFetchingNextPage,
    hasNextPage: hasNodeOrdersNextPage,
    refetch: refetchNodeOrders,
    isRefetching: isNodeOrdersRefetching,
  } = api.edge.orderbooks.getAllOrders.useInfiniteQuery(
    {
      userOsmoAddress: userAddress,
      limit: pageSize,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      initialCursor: 0,
      refetchInterval,
      cacheTime: refetchInterval,
      staleTime: refetchInterval,
      enabled: !!userAddress && addresses.length > 0 && !sqsActiveOrders,
      refetchOnMount: true,
      keepPreviousData: false,
      trpc: {
        abortOnUnmount: true,
        context: {
          skipBatch: true,
        },
      },
    }
  );

  return {
    data: sqsActiveOrders ? sqsOrders : nodeOrders,
    isLoading: sqsActiveOrders ? isSQSOrdersLoading : isNodeOrdersLoading,
    fetchNextPage: sqsActiveOrders
      ? fetchSQSOrdersNextPage
      : fetchNodeOrdersNextPage,
    isFetching: sqsActiveOrders ? isSQSOrdersFetching : isNodeOrdersFetching,
    isFetchingNextPage: sqsActiveOrders
      ? isSQSOrdersFetchingNextPage
      : isNodeOrdersFetchingNextPage,
    hasNextPage: sqsActiveOrders ? hasSQSOrdersNextPage : hasNodeOrdersNextPage,
    refetch: sqsActiveOrders ? refetchSQSOrders : refetchNodeOrders,
    isRefetching: sqsActiveOrders
      ? isSQSOrdersRefetching
      : isNodeOrdersRefetching,
  };
};

export const useOrderbookOrders = ({
  userAddress,
  pageSize = 10,
  refetchInterval = 10000,
  filter,
}: {
  userAddress: string;
  pageSize?: number;
  refetchInterval?: number;
  filter?: "active" | "filled" | "historical" | "open";
}) => {
  const {
    data: orders,
    isLoading,
    fetchNextPage,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    refetch,
    isRefetching,
  } = useOrdersQuery({ userAddress, pageSize, refetchInterval, filter });

  const allOrders = useMemo(() => {
    return orders?.pages.flatMap((page) => page.items) ?? [];
  }, [orders]);

  const refetchOrders = useCallback(async () => {
    if (isRefetching) return;
    await refetch();
  }, [refetch, isRefetching]);

  return {
    orders: allOrders,
    isLoading,
    fetchNextPage,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    refetch: refetchOrders,
    isRefetching,
  };
};

/**
 * Queries for all claimable orders for a given user.
 * Swaps between using SQS passthrough and a direct node query based on feature flag.
 * NOTE: CAN BE REMOVED WHEN SQSORDERS FEATURE FLAG IS REMOVED
 */
const useClaimableOrdersQuery = ({
  userAddress,
  disabled = false,
  refetchInterval = 5000,
}: {
  userAddress: string;
  disabled?: boolean;
  refetchInterval?: number;
}) => {
  const { orderbooks } = useOrderbooks();
  const { sqsActiveOrders } = useFeatureFlags();
  const addresses = orderbooks.map(({ contractAddress }) => contractAddress);
  const { data: claimableOrders, isLoading } =
    api.local.orderbooks.getAllOrdersSQS.useInfiniteQuery(
      {
        userOsmoAddress: userAddress,
        filter: "filled",
        limit: 100,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 0,
        refetchInterval,
        enabled:
          !!userAddress && addresses.length > 0 && !disabled && sqsActiveOrders,
        refetchOnMount: true,
        keepPreviousData: false,
        trpc: {
          abortOnUnmount: true,
          context: {
            skipBatch: true,
          },
        },
      }
    );

  const { data: nodeClaimableOrders, isLoading: nodeIsLoading } =
    api.edge.orderbooks.getClaimableOrders.useQuery(
      {
        userOsmoAddress: userAddress,
      },
      {
        enabled:
          !!userAddress &&
          addresses.length > 0 &&
          !disabled &&
          !sqsActiveOrders,
        refetchOnMount: true,
        keepPreviousData: false,
        trpc: {
          abortOnUnmount: true,
          context: {
            skipBatch: true,
          },
        },
      }
    );

  const orders = useMemo(() => {
    if (!sqsActiveOrders) return nodeClaimableOrders;
    return claimableOrders?.pages?.flatMap((page) => page.items) ?? [];
  }, [claimableOrders?.pages, nodeClaimableOrders, sqsActiveOrders]);

  return {
    data: orders,
    isLoading: sqsActiveOrders ? isLoading : nodeIsLoading,
  };
};

export const useOrderbookClaimableOrders = ({
  userAddress,
  disabled = false,
  refetchInterval = 5000,
}: {
  userAddress: string;
  disabled?: boolean;
  refetchInterval?: number;
}) => {
  const { orderbooks } = useOrderbooks();
  const { accountStore } = useStore();
  const account = accountStore.getWallet(accountStore.osmosisChainId);
  const addresses = orderbooks.map(({ contractAddress }) => contractAddress);
  const { data: orders, isLoading } = useClaimableOrdersQuery({
    userAddress,
    disabled,
    refetchInterval,
  });

  const claimAllOrders = useCallback(async () => {
    if (!account || !orders) return;
    const msgs = addresses
      .map((contractAddress) => {
        const ordersForAddress = orders.filter(
          (o) => o.orderbookAddress === contractAddress
        );
        if (ordersForAddress.length === 0) return;

        const msg = {
          batch_claim: {
            orders: ordersForAddress.map((o) => [o.tick_id, o.order_id]),
          },
        };
        return {
          contractAddress,
          msg,
          funds: [],
        };
      })
      .filter(Boolean) as {
      contractAddress: string;
      msg: object;
      funds: CoinPrimitive[];
    }[];

    if (msgs.length > 0) {
      await account?.cosmwasm.sendMultiExecuteContractMsg("executeWasm", msgs);
      // await refetch();
    }
  }, [orders, account, addresses]);

  return {
    orders: orders ?? [],
    count: orders?.length ?? 0,
    isLoading,
    claimAllOrders,
  };
};
