import express from "express";
import { createClient } from "redis";
import { json } from "body-parser";

const accountQueue = Object.create(null);
const DEFAULT_BALANCE = 100;
// So the issue is when there is high network usage and multiple requests are arriving simultaneously, specifically
// for a single account, since parallel requests for different accounts deal with different balances. An idea is to fetch
// the data once, initially, store it in a local dict, update it "offline", then long poll it to update at a fixed rate.

interface ChargeResult {
    isAuthorized: boolean;
    remainingBalance: number;
    charges: number;
}

async function connect(): Promise<ReturnType<typeof createClient>> {
    const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
    console.log(`Using redis URL ${url}`);
    const client = createClient({ url });
    await client.connect();
    return client;
}

async function reset(account: string): Promise<void> {
    const client = await connect();
    try {
        await client.set(`${account}/balance`, DEFAULT_BALANCE);
        accountQueue[account] = {
            charges: [],
            currentBalance: DEFAULT_BALANCE
        };
    } finally {
        await client.disconnect();
    }
}

// async function charge(account: string, charges: number): Promise<ChargeResult> {
//     const client = await connect();
//     try {
//         const balance = parseInt((await client.get(`${account}/balance`)) ?? "");
//         if (balance >= charges) {
//             await client.set(`${account}/balance`, balance - charges);
//             const remainingBalance = parseInt((await client.get(`${account}/balance`)) ?? "");
//             return await Promise.resolve({ isAuthorized: true, remainingBalance, charges });
//         } else {
//             return await Promise.resolve({ isAuthorized: false, remainingBalance: balance, charges: 0 });
//         }
//     } finally {
//         await client.disconnect();
//     }
// }

async function charge(account: string, charges: number): Promise<ChargeResult> {
    const client = await connect();
    try {
        const balance = accountQueue[account].currentBalance;
        const currentCharges = getCurrentChargesPerAccount(account);
        // const balance = parseFloat((await client.get(`${account}/balance`)) ?? "");
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        if (balance >= Math.abs(charges) + currentCharges) {
            // accountQueue[account].currentCharge += charges;
            accountQueue[account].charges.push(charges);
            const remainingBalance = balance - charges - currentCharges;
            // await client.set(`${account}/balance`, remainingBalance);
            // const remainingBalance = parseInt((await client.get(`${account}/balance`)) ?? "");
            return await Promise.resolve({ isAuthorized: true, remainingBalance, charges });
        } else {
            return await Promise.resolve({ isAuthorized: false, remainingBalance: balance, charges: 0 });
        }
    } finally {
        await client.disconnect();
    }
}

export function buildApp(): express.Application {
    const app = express();
    
    app.use(json());
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    app.post("/reset", async (req, res) => {
        try {
            const account = req.body.account ?? "account";
            await reset(account);
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            console.log(`Successfully reset account ${account}`);
            res.sendStatus(204);
        } catch (e) {
            console.error("Error while resetting account", e);
            res.status(500).json({ error: String(e) });
        }
    });
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    app.post("/charge", async (req, res) => {
        const client = await connect();
        try {
            const account: string = req.body.account ?? "account";
            // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
            if (!accountQueue[account]) {
                const initialBalance = parseFloat((await client.get(`${account}/balance`)) ?? "");

                accountQueue[account] = {
                    charges: [],
                    currentBalance: initialBalance
                };
            }
            // accountQueue[account].charges.push(req.body.charges ?? 10);
            const result = await charge(account, parseFloat(req.body.charges ?? 10));
            // const result = await accountQueue[account].unshift() as Promise<ChargeResult>;
            // const result = await charge(account, req.body.charges ?? 10);
            // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
            console.log(`Successfully charged account ${account}`);
            res.status(200).json(result);
        } catch (e) {
            console.error("Error while charging account", e);
            res.status(500).json({ error: String(e) });
        } finally {
            await client.disconnect();
        }
    });
    return app;
}

function getCurrentChargesPerAccount(account: string): number {
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    return accountQueue[account].charges.reduce((acc, curr) => acc + curr, 0);
}

async function startDbPoll(): Promise<void> {
    const client = await connect();

    for (const account in accountQueue) {
        if (accountQueue[account].charges.length > 0) {
            const discount = getCurrentChargesPerAccount(account);
            if (discount > 0) {
                await client.set(`${account}/balance`, accountQueue[account].currentBalance - discount);
                accountQueue[account].charges = [];
                accountQueue[account].currentBalance -= discount;
            }
        }
    }
    await client.disconnect();
}
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const runPoll = async () => {
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        await startDbPoll();
    }
}
// eslint-disable-next-line @typescript-eslint/no-floating-promises
runPoll();
