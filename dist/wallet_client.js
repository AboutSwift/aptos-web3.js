"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WalletClient = void 0;
const buffer_1 = require("buffer/");
const bip39 = __importStar(require("@scure/bip39"));
const english = __importStar(require("@scure/bip39/wordlists/english"));
const cross_fetch_1 = __importDefault(require("cross-fetch"));
const assert_1 = __importDefault(require("assert"));
const aptos_account_1 = require("./aptos_account");
const token_client_1 = require("./token_client");
const aptos_client_1 = require("./aptos_client");
const faucet_client_1 = require("./faucet_client");
const hex_string_1 = require("./hex_string");
const cache_1 = __importDefault(require("./utils/cache"));
const { HDKey } = require("@scure/bip32");
const COIN_TYPE = 637;
const MAX_ACCOUNTS = 5;
const ADDRESS_GAP = 10;
class WalletClient {
    constructor(node_url, faucet_url) {
        this.faucetClient = new faucet_client_1.FaucetClient(node_url, faucet_url);
        this.aptosClient = new aptos_client_1.AptosClient(node_url);
        this.tokenClient = new token_client_1.TokenClient(this.aptosClient);
    }
    /**
     * Each mnemonic phrase corresponds to a single wallet
     * Wallet can contain multiple accounts
     * An account corresponds to a key pair + address
     *
     * Get all the accounts of a user from their mnemonic phrase
     *
     * @param code The mnemonic phrase (12 word)
     * @returns Wallet object containing all accounts of a user
     */
    async importWallet(code) {
        let flag = false;
        let address = "";
        let publicKey = "";
        let derivationPath = "";
        let authKey = "";
        if (!bip39.validateMnemonic(code, english.wordlist)) {
            return Promise.reject(new Error("Incorrect mnemonic passed"));
        }
        const seed = bip39.mnemonicToSeedSync(code.toString());
        const node = HDKey.fromMasterSeed(buffer_1.Buffer.from(seed));
        const accountMetaData = [];
        for (let i = 0; i < MAX_ACCOUNTS; i += 1) {
            flag = false;
            address = "";
            publicKey = "";
            derivationPath = "";
            authKey = "";
            for (let j = 0; j < ADDRESS_GAP; j += 1) {
                /* eslint-disable no-await-in-loop */
                const exKey = node.derive(`m/44'/${COIN_TYPE}'/${i}'/0/${j}`);
                let acc = new aptos_account_1.AptosAccount(exKey.privateKey);
                if (j === 0) {
                    address = acc.authKey().toString();
                    publicKey = acc.pubKey().toString();
                    const response = await (0, cross_fetch_1.default)(`${this.aptosClient.nodeUrl}/accounts/${address}`, {
                        method: "GET",
                    });
                    if (response.status === 404) {
                        break;
                    }
                    const respBody = await response.json();
                    authKey = respBody.authentication_key;
                }
                acc = new aptos_account_1.AptosAccount(exKey.privateKey, address);
                if (acc.authKey().toString() === authKey) {
                    flag = true;
                    derivationPath = `m/44'/${COIN_TYPE}'/${i}'/0/${j}`;
                    break;
                }
                /* eslint-enable no-await-in-loop */
            }
            if (!flag) {
                break;
            }
            accountMetaData.push({
                derivationPath,
                address,
                publicKey,
            });
        }
        return { code, accounts: accountMetaData };
    }
    /**
     * Creates a new wallet which contains a single account,
     * which is registered on Aptos
     *
     * @returns A wallet object
     */
    async createWallet() {
        const code = bip39.generateMnemonic(english.wordlist); // mnemonic
        const accountMetadata = await this.createNewAccount(code);
        return { code, accounts: [accountMetadata] };
    }
    /**
     * Creates a new account in the provided wallet
     *
     * @param code mnemonic phrase of the wallet
     * @returns
     */
    async createNewAccount(code) {
        const seed = bip39.mnemonicToSeedSync(code.toString());
        const node = HDKey.fromMasterSeed(buffer_1.Buffer.from(seed));
        for (let i = 0; i < MAX_ACCOUNTS; i += 1) {
            /* eslint-disable no-await-in-loop */
            const derivationPath = `m/44'/${COIN_TYPE}'/${i}'/0/0`;
            const exKey = node.derive(derivationPath);
            const acc = new aptos_account_1.AptosAccount(exKey.privateKey);
            const address = acc.authKey().toString();
            const response = await (0, cross_fetch_1.default)(`${this.aptosClient.nodeUrl}/accounts/${address}`, {
                method: "GET",
            });
            if (response.status === 404) {
                await this.faucetClient.fundAccount(acc.authKey(), 0);
                return {
                    derivationPath,
                    address,
                    publicKey: acc.pubKey().toString(),
                };
            }
            /* eslint-enable no-await-in-loop */
        }
        throw new Error("Max no. of accounts reached");
    }
    /**
     * returns an AptosAccount object given a private key and
     * address of the account
     *
     * @param privateKey Private key of an account as a Buffer
     * @param address address of a user
     * @returns AptosAccount object
     */
    static getAccountFromPrivateKey(privateKey, address) {
        return new aptos_account_1.AptosAccount(privateKey, address);
    }
    /**
     * returns an AptosAccount at position m/44'/COIN_TYPE'/0'/0/0
     *
     * @param code mnemonic phrase of the wallet
     * @returns AptosAccount object
     */
    static getAccountFromMnemonic(code) {
        const seed = bip39.mnemonicToSeedSync(code.toString());
        const node = HDKey.fromMasterSeed(buffer_1.Buffer.from(seed));
        const exKey = node.derive(`m/44'/${COIN_TYPE}'/0'/0/0`);
        return new aptos_account_1.AptosAccount(exKey.privateKey);
    }
    /**
     * returns an AptosAccount object for the desired account
     * using the metadata of the account
     *
     * @param code mnemonic phrase of the wallet
     * @param metaData metadata of the account to be fetched
     * @returns
     */
    static getAccountFromMetaData(code, metaData) {
        const seed = bip39.mnemonicToSeedSync(code.toString());
        const node = HDKey.fromMasterSeed(buffer_1.Buffer.from(seed));
        const exKey = node.derive(metaData.derivationPath);
        return new aptos_account_1.AptosAccount(exKey.privateKey, metaData.address);
    }
    /**
     * airdrops test coins in the given account
     *
     * @param address address of the receiver's account
     * @param amount amount to be airdropped
     * @returns list of transaction hashs
     */
    async airdrop(address, amount) {
        return Promise.resolve(await this.faucetClient.fundAccount(address, amount));
    }
    /**
     * returns the balance of the said account
     *
     * @param address address of the desired account
     * @returns balance of the account
     */
    async getBalance(address) {
        let balance = 0;
        const resources = await this.aptosClient.getAccountResources(address);
        Object.values(resources).forEach((value) => {
            if (value.type === "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>") {
                balance = Number(value.data.coin.value);
            }
        });
        return Promise.resolve(balance);
    }
    /**
     * returns the list of on-chain transactions sent by the said account
     *
     * @param accountAddress address of the desired account
     * @returns list of transactions
     */
    async accountTransactions(accountAddress) {
        const data = await this.aptosClient.getAccountTransactions(accountAddress);
        const transactions = data.map((item) => ({
            data: item.payload,
            from: item.sender,
            gas: item.gas_used,
            gasPrice: item.gas_unit_price,
            hash: item.hash,
            success: item.success,
            timestamp: item.timestamp,
            toAddress: item.payload.arguments[0],
            price: item.payload.arguments[1],
            type: item.type,
            version: item.version,
            vmStatus: item.vm_status,
        }));
        return transactions;
    }
    /**
     * transfers Aptos Coins from signer to receiver
     *
     * @param account AptosAccount object of the signing account
     * @param recipient_address address of the receiver account
     * @param amount amount of aptos coins to be transferred
     * @returns transaction hash
     */
    async transfer(account, recipient_address, amount) {
        try {
            if (recipient_address.toString() === account.address().toString()) {
                return new Error("cannot transfer coins to self");
            }
            const payload = {
                type: "script_function_payload",
                function: "0x1::coin::transfer",
                type_arguments: ["0x1::aptos_coin::AptosCoin"],
                arguments: [
                    `${hex_string_1.HexString.ensure(recipient_address)}`,
                    amount.toString(),
                ],
            };
            return await this.tokenClient.submitTransactionHelper(account, payload, {
                max_gas_amount: "4000",
            });
        }
        catch (err) {
            return Promise.reject(err);
        }
    }
    /**
     * returns the list of events involving transactions
     * starting from the said account
     *
     * @param address address of the desired account
     * @returns list of events
     */
    async getSentEvents(address, limit, start) {
        return Promise.resolve(await this.aptosClient.getAccountTransactions(address, { start, limit }));
    }
    /**
     * returns the list of events involving transactions of Aptos Coins
     * received by the said account
     *
     * @param address address of the desired account
     * @returns list of events
     */
    async getReceivedEvents(address, limit, start) {
        return Promise.resolve(await this.aptosClient.getEventsByEventHandle(address, "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>", "deposit_events", { start, limit }));
    }
    /**
     * creates an NFT collection
     *
     * @param account AptosAccount object of the signing account
     * @param name collection name
     * @param description collection description
     * @param uri collection URI
     * @returns transaction hash
     */
    async createCollection(account, name, description, uri) {
        return Promise.resolve(await this.tokenClient.createCollection(account, name, description, uri));
    }
    /**
     * creates an NFT
     *
     * @param account AptosAccount object of the signing account
     * @param collection_name collection name
     * @param name NFT name
     * @param description NFT description
     * @param supply supply for the NFT
     * @param uri NFT URI
     * @param royalty_points_per_million royalty points per million
     * @returns transaction hash
     */
    async createToken(account, collection_name, name, description, supply, uri, royalty_payee_address = account.address(), royalty_points_denominator = 0, royalty_points_numerator = 0, property_keys = [], property_values = [], property_types = []) {
        return Promise.resolve(await this.tokenClient.createToken(account, collection_name, name, description, supply, uri, royalty_payee_address, royalty_points_denominator, royalty_points_numerator, property_keys, property_values, property_types));
    }
    /**
     * offers an NFT to another account
     *
     * @param account AptosAccount object of the signing account
     * @param receiver_address address of the receiver account
     * @param creator_address address of the creator account
     * @param collection_name collection name
     * @param token_name NFT name
     * @param amount amount to receive while offering the token
     * @returns transaction hash
     */
    async offerToken(account, receiver_address, creator_address, collection_name, token_name, amount, property_version = 0) {
        return Promise.resolve(await this.tokenClient.offerToken(account, receiver_address, creator_address, collection_name, token_name, amount, property_version));
    }
    /**
     * cancels an NFT offer
     *
     * @param account AptosAccount of the signing account
     * @param receiver_address address of the receiver account
     * @param creator_address address of the creator account
     * @param collection_name collection name
     * @param token_name NFT name
     * @returns transaction hash
     */
    async cancelTokenOffer(account, receiver_address, creator_address, collection_name, token_name, property_version = 0) {
        return Promise.resolve(await this.tokenClient.cancelTokenOffer(account, receiver_address, creator_address, collection_name, token_name, property_version));
    }
    /**
     * claims offered NFT
     *
     * @param account AptosAccount of the signing account
     * @param sender_address address of the sender account
     * @param creator_address address of the creator account
     * @param collection_name collection name
     * @param token_name NFT name
     * @returns transaction hash
     */
    async claimToken(account, sender_address, creator_address, collection_name, token_name, property_version = 0) {
        return Promise.resolve(await this.tokenClient.claimToken(account, sender_address, creator_address, collection_name, token_name, property_version));
    }
    /**
     * sign a generic transaction
     *
     * @param account AptosAccount of the signing account
     * @param func function name to be called
     * @param args arguments of the function to be called
     * @param type_args type arguments of the function to be called
     * @returns transaction hash
     */
    async signGenericTransaction(account, func, args, type_args) {
        const payload = {
            type: "script_function_payload",
            function: func,
            type_arguments: type_args,
            arguments: args,
        };
        const txnHash = await this.tokenClient.submitTransactionHelper(account, payload);
        const resp = await this.aptosClient.getTransaction(txnHash);
        const status = { success: resp.success, vm_status: resp.vm_status };
        return { txnHash, ...status };
    }
    async signAndSubmitTransaction(account, txnRequest) {
        const signedTxn = await this.aptosClient.signTransaction(account, txnRequest);
        const res = await this.aptosClient.submitTransaction(signedTxn);
        await this.aptosClient.waitForTransaction(res.hash);
        return Promise.resolve(res.hash);
    }
    // sign and submit multiple transactions
    async signAndSubmitTransactions(account, txnRequests) {
        const hashs = [];
        // eslint-disable-next-line no-restricted-syntax
        for (const txnRequest of txnRequests) {
            /* eslint-disable no-await-in-loop */
            try {
                txnRequest.sequence_number = (await this.aptosClient.getAccount(account.address().toString())).sequence_number;
                const signedTxn = await this.aptosClient.signTransaction(account, txnRequest);
                const res = await this.aptosClient.submitTransaction(signedTxn);
                await this.aptosClient.waitForTransaction(res.hash);
                hashs.push(res.hash);
            }
            catch (err) {
                hashs.push(err.message);
            }
            /* eslint-enable no-await-in-loop */
        }
        return Promise.resolve(hashs);
    }
    async signTransaction(account, txnRequest) {
        return Promise.resolve(await this.aptosClient.signTransaction(account, txnRequest));
    }
    async estimateGasFees(account, transaction) {
        const simulateResponse = await this.aptosClient.simulateTransaction(account, transaction);
        return simulateResponse.gas_used;
    }
    async estimateCost(account, transaction) {
        const txnData = await this.aptosClient.simulateTransaction(account, transaction);
        const currentBalance = await this.getBalance(account.address());
        const change = txnData.changes.filter((ch) => {
            if (ch.type !== "write_resource") {
                return false;
            }
            const write = ch;
            if (write.data.type ===
                "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>" &&
                write.address === account.address().toString()) {
                return true;
            }
            return false;
        });
        if (change.length > 0) {
            /* eslint-disable @typescript-eslint/dot-notation */
            return (currentBalance -
                parseInt(change[0]["data"].data["coin"].value, 10) -
                parseInt(txnData.gas_used, 10)).toString();
        }
        return "0";
    }
    async submitTransaction(signedTxn) {
        return Promise.resolve(await this.aptosClient.submitTransaction(signedTxn));
    }
    static generateBCSTransaction(account, rawTxn) {
        return Promise.resolve(aptos_client_1.AptosClient.generateBCSTransaction(account, rawTxn));
    }
    static generateBCSSimulation(account, rawTxn) {
        return Promise.resolve(aptos_client_1.AptosClient.generateBCSSimulation(account, rawTxn));
    }
    async submitSignedBCSTransaction(signedTxn) {
        return Promise.resolve(await this.aptosClient.submitSignedBCSTransaction(signedTxn));
    }
    async submitBCSSimulation(bcsBody) {
        return Promise.resolve(await this.aptosClient.submitBCSSimulation(bcsBody));
    }
    static signMessage(account, message) {
        return Promise.resolve(account.signBuffer(buffer_1.Buffer.from(message)).hex());
    }
    /**
     * Rotates the auth key
     *
     * @param code mnemonic phrase for the desired wallet
     * @param metaData metadata for the desired account
     * @returns status object
     */
    async rotateAuthKey(code, metaData) {
        const account = await WalletClient.getAccountFromMetaData(code, metaData);
        const pathSplit = metaData.derivationPath.split("/");
        const addressIndex = Number(pathSplit[pathSplit.length - 1]);
        if (addressIndex >= ADDRESS_GAP - 1) {
            throw new Error("Maximum key rotation reached");
        }
        const newDerivationPath = `${pathSplit
            .slice(0, pathSplit.length - 1)
            .join("/")}/${addressIndex + 1}`;
        const newAccount = await WalletClient.getAccountFromMetaData(code, {
            address: metaData.address,
            derivationPath: newDerivationPath,
        });
        const newAuthKey = newAccount.authKey().toString().split("0x")[1];
        const transactionStatus = await this.signGenericTransaction(account, "0x1::account::rotate_authentication_key", [newAuthKey], []);
        if (!transactionStatus.success) {
            return {
                authkey: "",
                success: false,
                vm_status: transactionStatus.vm_status,
            };
        }
        return {
            authkey: `0x${newAuthKey}`,
            success: true,
            vm_status: transactionStatus.vm_status,
        };
    }
    async getEventStream(address, eventHandleStruct, fieldName, limit, start) {
        let endpointUrl = `${this.aptosClient.nodeUrl}/accounts/${address}/events/${eventHandleStruct}/${fieldName}`;
        if (limit) {
            endpointUrl += `?limit=${limit}`;
        }
        if (start) {
            endpointUrl += limit ? `&start=${start}` : `?start=${start}`;
        }
        const response = await (0, cross_fetch_1.default)(endpointUrl, {
            method: "GET",
        });
        if (response.status === 404) {
            return [];
        }
        return Promise.resolve(await response.json());
    }
    /**
     * returns a list of token IDs of the tokens in a user's account
     * (including the tokens that were minted)
     *
     * @param address address of the desired account
     * @returns list of token IDs
     */
    async getTokenIds(address, limit, start) {
        const countDeposit = {};
        const countWithdraw = {};
        const tokenIds = [];
        const depositEvents = await this.getEventStream(address, "0x3::token::TokenStore", "deposit_events", limit, start);
        const withdrawEvents = await this.getEventStream(address, "0x3::token::TokenStore", "withdraw_events", limit, start);
        depositEvents.forEach((element) => {
            const elementString = JSON.stringify(element.data.id);
            countDeposit[elementString] = countDeposit[elementString]
                ? countDeposit[elementString] + 1
                : 1;
        });
        withdrawEvents.forEach((element) => {
            const elementString = JSON.stringify(element.data.id);
            countWithdraw[elementString] = countWithdraw[elementString]
                ? countWithdraw[elementString] + 1
                : 1;
        });
        depositEvents.forEach((element) => {
            const elementString = JSON.stringify(element.data.id);
            const count1 = countDeposit[elementString];
            const count2 = countWithdraw[elementString]
                ? countWithdraw[elementString]
                : 0;
            if (count1 - count2 === 1) {
                tokenIds.push({
                    data: element.data.id,
                    sequence_number: element.sequence_number,
                    difference: count1 - count2,
                });
            }
        });
        return tokenIds;
    }
    /**
     * returns the tokens in an account
     *
     * @param address address of the desired account
     * @returns list of tokens and their collection data
     */
    async getTokens(address, limit, start) {
        const tokenIds = await this.getTokenIds(address, limit, start);
        const tokens = [];
        await Promise.all(tokenIds.map(async (tokenId) => {
            let resources;
            if (cache_1.default.has(`resources--${tokenId.data.token_data_id.creator}`)) {
                resources = cache_1.default.get(`resources--${tokenId.data.token_data_id.creator}`);
            }
            else {
                resources = await this.aptosClient.getAccountResources(tokenId.data.token_data_id.creator);
                cache_1.default.set(`resources--${tokenId.data.token_data_id.creator}`, resources);
            }
            const accountResource = resources.find((r) => r.type === "0x3::token::Collections");
            const tableItemRequest = {
                key_type: "0x3::token::TokenDataId",
                value_type: "0x3::token::TokenData",
                key: tokenId.data.token_data_id,
            };
            const cacheKey = JSON.stringify(tableItemRequest);
            let token;
            if (cache_1.default.has(cacheKey)) {
                token = cache_1.default.get(cacheKey);
            }
            else {
                token = (await this.aptosClient.getTableItem(accountResource.data.token_data.handle, tableItemRequest)).data;
                cache_1.default.set(cacheKey, token);
            }
            token.collection = tokenId.data.token_data_id.collection;
            tokens.push({ token, sequence_number: tokenId.sequence_number });
        }));
        return tokens;
    }
    /**
     * returns the resource handle for type 0x3::token::Collections
     * about a said creator
     *
     * @param tokenId token ID of the desired token
     * @returns resource information
     */
    async getTokenResourceHandle(tokenId) {
        const resources = await this.aptosClient.getAccountResources(tokenId.token_data_id.creator);
        const accountResource = resources.find((r) => r.type === "0x3::token::Collections");
        return accountResource.data.token_data.handle;
    }
    /**
     * returns the token information (including the collection information)
     * about a said tokenID
     *
     * @param tokenId token ID of the desired token
     * @returns token information
     */
    async getToken(tokenId, resourceHandle) {
        let accountResource;
        if (!resourceHandle) {
            const resources = await this.aptosClient.getAccountResources(tokenId.token_data_id.creator);
            accountResource = resources.find((r) => r.type === "0x3::token::Collections");
        }
        const tableItemRequest = {
            key_type: "0x3::token::TokenDataId",
            value_type: "0x3::token::TokenData",
            key: tokenId.token_data_id,
        };
        const token = (await this.aptosClient.getTableItem(resourceHandle || accountResource.data.token_data.handle, tableItemRequest)).data;
        token.collection = tokenId.token_data_id.collection;
        return token;
    }
    /**
     * returns the information about a collection of an account
     *
     * @param address address of the desired account
     * @param collectionName collection name
     * @returns collection information
     */
    async getCollection(address, collectionName) {
        const resources = await this.aptosClient.getAccountResources(address);
        const accountResource = resources.find((r) => r.type === "0x3::token::Collections");
        const tableItemRequest = {
            key_type: "0x1::string::String",
            value_type: "0x3::token::Collection",
            key: collectionName,
        };
        const collection = (await this.aptosClient.getTableItem(accountResource.data.collections.handle, tableItemRequest)).data;
        return collection;
    }
    async getCustomResource(address, resourceType, fieldName, keyType, valueType, key) {
        const resources = await this.aptosClient.getAccountResources(address);
        const accountResource = resources.find((r) => r.type === resourceType);
        const tableItemRequest = {
            key_type: keyType,
            value_type: valueType,
            key,
        };
        const resource = (await this.aptosClient.getTableItem(accountResource.data[fieldName].handle, tableItemRequest)).data;
        return resource;
    }
    /**
     * returns info about a particular resource inside an account
     *
     * @param accountAddress address of the desired account
     * @param resourceType type of the desired resource
     * @returns resource information
     */
    async getAccountResource(accountAddress, resourceType) {
        const response = await (0, cross_fetch_1.default)(`${this.aptosClient.nodeUrl}/accounts/${accountAddress}/resource/${resourceType}`, { method: "GET" });
        if (response.status === 404) {
            return null;
        }
        if (response.status !== 200) {
            (0, assert_1.default)(response.status === 200, await response.text());
        }
        return Promise.resolve(await response.json());
    }
    /**
     * initializes a coin
     *
     * precondition: a module of the desired coin has to be deployed in the signer's account
     *
     * @param account AptosAccount object of the signing account
     * @param coin_type_path address path of the desired coin
     * @param name name of the coin
     * @param symbol symbol of the coin
     * @param scaling_factor scaling factor of the coin
     * @returns transaction hash
     */
    async initializeCoin(account, coin_type_path, // coin_type_path: something like 0x${coinTypeAddress}::moon_coin::MoonCoin
    name, symbol, scaling_factor) {
        const payload = {
            type: "script_function_payload",
            function: "0x1::managed_coin::initialize",
            type_arguments: [coin_type_path],
            arguments: [
                buffer_1.Buffer.from(name).toString("hex"),
                buffer_1.Buffer.from(symbol).toString("hex"),
                scaling_factor.toString(),
                false,
            ],
        };
        const txnHash = await this.tokenClient.submitTransactionHelper(account, payload);
        const resp = await this.aptosClient.getTransaction(txnHash);
        const status = { success: resp.success, vm_status: resp.vm_status };
        return { txnHash, ...status };
    }
    /**
     * registers a coin for an account
     *
     * creates the resource for the desired account such that
     * the account can start transacting in the desired coin
     *
     * @param account AptosAccount object of the signing account
     * @param coin_type_path address path of the desired coin
     * @returns transaction hash
     */
    async registerCoin(account, coin_type_path) {
        // coin_type_path: something like 0x${coinTypeAddress}::moon_coin::MoonCoin
        const payload = {
            type: "script_function_payload",
            function: "0x1::coins::register",
            type_arguments: [coin_type_path],
            arguments: [],
        };
        const txnHash = await this.tokenClient.submitTransactionHelper(account, payload);
        const resp = await this.aptosClient.getTransaction(txnHash);
        const status = { success: resp.success, vm_status: resp.vm_status };
        return { txnHash, ...status };
    }
    /**
     * mints a coin in a receiver account
     *
     * precondition: the signer should have minting capability
     * unless specifically granted, only the account where the module
     * of the desired coin lies has the minting capability
     *
     * @param account AptosAccount object of the signing account
     * @param coin_type_path address path of the desired coin
     * @param dst_address address of the receiver account
     * @param amount amount to be minted
     * @returns transaction hash
     */
    async mintCoin(account, coin_type_path, // coin_type_path: something like 0x${coinTypeAddress}::moon_coin::MoonCoin
    dst_address, amount) {
        const payload = {
            type: "script_function_payload",
            function: "0x1::managed_coin::mint",
            type_arguments: [coin_type_path],
            arguments: [dst_address.toString(), amount.toString()],
        };
        const txnHash = await this.tokenClient.submitTransactionHelper(account, payload);
        const resp = await this.aptosClient.getTransaction(txnHash);
        const status = { success: resp.success, vm_status: resp.vm_status };
        return { txnHash, ...status };
    }
    /**
     * transfers coin (applicable for all altcoins on Aptos) to receiver account
     *
     * @param account AptosAccount object of the signing account
     * @param coin_type_path address path of the desired coin
     * @param to_address address of the receiver account
     * @param amount amount to be transferred
     * @returns transaction hash
     */
    async transferCoin(account, coin_type_path, // coin_type_path: something like 0x${coinTypeAddress}::moon_coin::MoonCoin
    to_address, amount) {
        const payload = {
            type: "script_function_payload",
            function: "0x1::coin::transfer",
            type_arguments: [coin_type_path],
            arguments: [to_address.toString(), amount.toString()],
        };
        const txnHash = await this.tokenClient.submitTransactionHelper(account, payload);
        const resp = await this.aptosClient.getTransaction(txnHash);
        const status = { success: resp.success, vm_status: resp.vm_status };
        return { txnHash, ...status };
    }
    /**
     * returns the information about the coin
     *
     * @param coin_type_path address path of the desired coin
     * @returns coin information
     */
    async getCoinData(coin_type_path) {
        const coinData = await this.getAccountResource(coin_type_path.split("::")[0], `0x1::coin::CoinInfo<${coin_type_path}>`);
        return coinData;
    }
    /**
     * returns the balance of the coin for an account
     *
     * @param address address of the desired account
     * @param coin_type_path address path of the desired coin
     * @returns number of coins
     */
    async getCoinBalance(address, coin_type_path) {
        // coin_type_path: something like 0x${coinTypeAddress}::moon_coin::MoonCoin
        const coinInfo = await this.getAccountResource(address, `0x1::coin::CoinStore<${coin_type_path}>`);
        return Number(coinInfo.data.coin.value);
    }
}
exports.WalletClient = WalletClient;
//# sourceMappingURL=wallet_client.js.map