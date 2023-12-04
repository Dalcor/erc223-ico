import {
  useAccount,
  useContractWrite,
  useNetwork,
  usePrepareContractWrite,
  usePublicClient,
  useSendTransaction
} from "wagmi";
import { ICOContractAddressETH, tokensToPayWith } from "@/constants/tokens";
import { parseUnits } from "viem";
import { useEffect, useMemo } from "react";
import testICOABI from "@/constants/abis/icoABI.json";
import { useRecentTransactionsStore } from "@/stores/useRecentTransactions";
import {
  useTransactionGasFee, useTransactionGasLimit,
  useTransactionGasPrice,
  useTransactionPriorityFee,
  useTransactionTypeStore
} from "@/stores/useGasSettings";
import { useSnackbar } from "@/providers/SnackbarProvider";
import { usePurchaseData } from "@/stores/usePurchaseData";
import { useReward } from "@/components/organisms/purchase-components/BuyForm/hooks/useReward";
import { isNativeToken } from "@/functions/isNativeToken";

function stringifyObject(object: { [key: string]: any }) {
  return JSON.parse(JSON.stringify(object, (key, value) =>
    typeof value === 'bigint'
      ? value.toString()
      : value // return everything else unchanged
  ));
}

export function usePurchaseTokens() {
  const {
    setPickedTokenId,
    amountToPay,
    pickedToken
  } = usePurchaseData((state) => ({
    setPickedTokenId: state.setPickedTokenId,
    amountToPay: state.amountToPay,
    pickedToken: state.computed.pickedToken
  }));

  const { addTransaction, isViewed } = useRecentTransactionsStore();
  const { address } = useAccount();

  const { chain } = useNetwork();
  const publicClient = usePublicClient({ chainId: chain?.id });

  const { type } = useTransactionTypeStore();

  const { maxFeePerGas } = useTransactionGasFee();
  const { maxPriorityFeePerGas } = useTransactionPriorityFee();
  const { gasPrice } = useTransactionGasPrice();
  const { gasLimit } = useTransactionGasLimit();

  const { showMessage } = useSnackbar();

  const gasSettings: {gasPrice: bigint} | {maxFeePerGas: bigint, maxPriorityFeePerGas: bigint} = useMemo(() => {
    if (type === "legacy") {
      return { gasPrice }
    } else {
      return { maxPriorityFeePerGas, maxFeePerGas }
    }
  }, [gasPrice, maxFeePerGas, maxPriorityFeePerGas, type]);

  useEffect(() => {
    setPickedTokenId(tokensToPayWith[0].id);
  }, [setPickedTokenId, chain]);

  const { output } = useReward({ pickedToken, amountToPay });

  const { config: purchaseConfig, error } = usePrepareContractWrite({
    address: ICOContractAddressETH,
    abi: testICOABI,
    functionName: 'purchaseTokens',
    gas: gasLimit,
    ...gasSettings,
    args: [
      pickedToken.address,
      parseUnits(amountToPay, pickedToken.decimals)
    ],
    cacheTime: 0,
    enabled: !isNativeToken(pickedToken)
  });

  const {
    write: purchaseWithTokens,
    isLoading: waitingForPurchaseWithTokens
  } = useContractWrite({
    ...purchaseConfig,
    onSettled: async (data, error) => {
      if (error) {
        return showMessage("Something went wrong", "error");
      }

      showMessage("Transaction submitted!");
      const _nonce = await publicClient.getTransactionCount({
        address,
        blockTag: "pending"
      });

      addTransaction({
          hash: data.hash,
          chainId: chain.id,
          title: `Purchase ${output || 0} DEX223 for ${amountToPay} ${pickedToken.symbol}`,
          type: type === "default" ? 2 : 0,
          details: {
            nonce: _nonce - 1,
            address: ICOContractAddressETH,
            abi: "ICO_ABI",
            functionName: 'purchaseTokens',
            gas: gasLimit.toString(),
            ...stringifyObject(gasSettings),
            args: [
              pickedToken.address,
              parseUnits(amountToPay, pickedToken.decimals).toString()
            ]
          }
        },
        address
      );
    }
  });

  const { data, sendTransaction: purchaseWithCoins, isLoading: waitingForPurchaseWithCoins } =
    useSendTransaction({
      to: ICOContractAddressETH,
      value: parseUnits(amountToPay, pickedToken.decimals),
      gas: gasLimit,
      ...gasSettings,
      onSettled: async (data) => {
        const _nonce = await publicClient.getTransactionCount({
          address,
          blockTag: "pending"
        });

        addTransaction({
            hash: data.hash,
            chainId: chain.id,
            title: `Purchase ${output || 0} DEX223 for ${amountToPay} ${pickedToken.symbol}`,
            type: type === "default" ? 2 : 0,
            details: {
              nonce: _nonce - 1,
              to: ICOContractAddressETH,
              value: parseUnits(amountToPay, pickedToken.decimals).toString(),
              gas: gasLimit.toString(),
              ...stringifyObject(gasSettings)
            },
          }, address
        )
      }
    })

  const isLoading = useMemo(() => {
    return waitingForPurchaseWithCoins || waitingForPurchaseWithTokens;
  }, [waitingForPurchaseWithCoins, waitingForPurchaseWithTokens]);

  return {
    purchaseWithCoins,
    purchaseWithTokens,
    isLoading,
    error
  }
}