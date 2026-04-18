import { Asset, BASE_FEE, Horizon, Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { config } from "../config/env.js";

type InputNativePayment = {
    sourceSecret: string;
    destination: string;
    amount: string;
    memo?: string | undefined;
}

type SubmittedStellarTransaction = {
    sourceAccount: string;
    hash: string;
    resultXdr: string;
    envelopeXdr: string;
};

export async function submitNativePayment(input: InputNativePayment): Promise<SubmittedStellarTransaction> {
    const keypair = Keypair.fromSecret(input.sourceSecret);
    const publicKey = keypair.publicKey();

    const server = new Horizon.Server(config.stellarHorizonUrl);
    const account = await server.loadAccount(publicKey);

    const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: config.stellarNetworkPassphrase
    });
    builder.addOperation(Operation.payment({
        amount: input.amount,
        asset: Asset.native(),
        destination: input.destination,
    }));

    if (input.memo) {
        builder.addMemo(Memo.text(input.memo));
    }

    const tx = builder.setTimeout(300).build();
    tx.sign(keypair);
    const resp = await server.submitTransaction(tx);
    return {
        sourceAccount: publicKey,
        hash: resp.hash,
        resultXdr: resp.result_xdr,
        envelopeXdr: resp.envelope_xdr,
    }
}

export function publicKeyFromSecret(sourceSecret: string): string {
    return Keypair.fromSecret(sourceSecret).publicKey();
}

export async function getAccount(publicKey: string): Promise<Horizon.AccountResponse> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    return server.loadAccount(publicKey);
}

export async function getTransactionByHash(txHash: string): Promise<Horizon.ServerApi.TransactionRecord> {
    const server = new Horizon.Server(config.stellarHorizonUrl);
    return server.transactions().transaction(txHash).call();
}
