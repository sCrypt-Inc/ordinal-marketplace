// App.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Addr, ContractCalledEvent, MethodCallOptions, PandaSigner, PubKey, Scrypt, ScryptProvider, SignTransactionOptions, SignatureRequest, SignatureResponse, StatefulNext, UTXO, Utils, bsv, byteString2Int, findSig, int2ByteString, reverseByteString, slice, toByteString } from 'scrypt-ts';
import { OneSatApis, OrdiNFTP2PKH } from 'scrypt-ord';
import { Box, Button, Tab, Tabs } from '@mui/material';
import ItemViewWallet from './ItemViewWallet';
import { Item, OrdinalMarket } from './contracts/ordinalsMarket';
import ItemViewMarket from './ItemViewMarket';

// Run `npx scrypt-cli@latest deploy` to deploy a new instance.
const contract_id = {
  /** The deployment transaction id */
  txId: "93cc52e5fa6e9c95125fa11ff2f2a969852abfa730986b6ebe6d764809e15a59",
  /** The output index */
  outputIndex: 0,
};

const App: React.FC = () => {
  const signerRef = useRef<PandaSigner>();


  const [contractInstance, setContract] = useState<OrdinalMarket>();
  const [isConnected, setIsConnected] = useState(false)
  const [connectedOrdiAddress, setConnectedOrdiAddress] = useState<bsv.Address>(undefined)
  const [walletItems, setWalletItems] = useState([])
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    fetchContract()

    const subscription = Scrypt.contractApi.subscribe(
      {
        clazz: OrdinalMarket,
        id: contract_id,
      },
      (event: ContractCalledEvent<OrdinalMarket>) => {
        console.log('Got event from sCrypt service:', event)
        setContract(event.nexts[0]);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    loadWalletItems()
  }, [connectedOrdiAddress]);


  async function fetchContract() {
    try {
      const instance = await Scrypt.contractApi.getLatestInstance(
        OrdinalMarket,
        contract_id
      );
      setContract(instance)
    } catch (error: any) {
      console.error("fetchContract error: ", error);
    }
  }

  async function loadWalletItems() {
    const signer = signerRef.current as PandaSigner;

    if (signer) {
      try {
        const connectedOrdiAddressStr = connectedOrdiAddress.toString();
        const url = `https://testnet.ordinals.gorillapool.io/api/txos/address/${connectedOrdiAddressStr}/unspent?bsv20=false`;

        const response = await fetch(url);
        const data = await response.json();

        const filteredData = data.filter(e => e.origin.data.insc.file.type !== 'application/bsv-20')

        // Filter items on the marketplace.
        if (contractInstance) {
          const filteredDataNoMarket = []
          filteredData.map((dataItem, idx) => {
            const isOnMarket = contractInstance.items.filter((marketItem) => {
              if (marketItem.isEmptySlot) {
                return false
              }
              const txId = reverseByteString(slice(marketItem.outpoint, 0n, 32n), 32n)
              const vout = byteString2Int(slice(marketItem.outpoint, 32n, 36n))
              const outpointStr = `${txId}_${vout.toString()}`
              return outpointStr == dataItem.outpoint
            }).length > 0
            if (!isOnMarket) {
              filteredDataNoMarket.push(dataItem)
            }
          })
          setWalletItems(filteredDataNoMarket);
        } else {
          setWalletItems(filteredData);
        }
      } catch (error) {
        console.error('Error fetching wallet items:', error);
      }
    }
  }

  const handleList = async (idx: number, priceSats: number) => {
    const signer = signerRef.current as PandaSigner;

    const { isAuthenticated, error } = await signer.requestAuth();
    if (!isAuthenticated) {
      throw new Error(error);
    }

    const item = walletItems[idx]
    const outpoint = item.outpoint

    // Create a P2PKH object from a UTXO.
    OneSatApis.setNetwork(bsv.Networks.testnet)
    const utxo: UTXO = await OneSatApis.fetchUTXOByOutpoint(outpoint)
    const p2pkh = OrdiNFTP2PKH.fromUTXO(utxo)

    await contractInstance.connect(signer);

    // Create the next instance from the current.
    const nextInstance = contractInstance.next();

    // Construct new item object.
    const sellerAddr = Addr(connectedOrdiAddress.toByteString())
    const outpointBS = reverseByteString(toByteString(outpoint.slice(0, 64)), 32n) +
      int2ByteString(BigInt(outpoint.slice(66)), 4n)

    const toAdd: Item = {
      outpoint: outpointBS,
      price: BigInt(priceSats),
      sellerAddr,
      isEmptySlot: false,
      hasRequestingBuyer: false,
      requestingBuyer: Addr(toByteString('0000000000000000000000000000000000000000'))
    }

    // Find first empty slot and insert new item.
    let itemIdx = undefined
    for (let i = 0; i < OrdinalMarket.ITEM_SLOTS; i++) {
      const item = contractInstance.items[i]
      if (item.isEmptySlot) {
        itemIdx = BigInt(i)
        nextInstance.items[i] = toAdd
        break
      }
    }

    if (itemIdx === undefined) {
      console.error('All item slots are filled.')
      return
    }

    // Call the method of current instance to apply the updates on chain.
    contractInstance.methods
      .listItem(
        toAdd,
        itemIdx,
        {
          next: {
            instance: nextInstance,
            balance: contractInstance.balance,
          },
        }
      )
      .then((result) => {
        console.log(`Add item call tx: ${result.tx.id}`);
        fetchContract()
      })
      .catch((e) => {
        console.error("Add item call error: ", e);
      });
  };

  const handleBuyRequest = async (itemIdx: number) => {
    const signer = signerRef.current as PandaSigner;
    await contractInstance.connect(signer);

    const itemPrice = Number(contractInstance.items[itemIdx].price)
    const myAddr = Addr(connectedOrdiAddress.toByteString())

    // Create the next instance from the current.
    const nextInstance = contractInstance.next()
    nextInstance.items[itemIdx].hasRequestingBuyer = true
    nextInstance.items[itemIdx].requestingBuyer = myAddr

    // Call the method of current instance to apply the updates on chain.
    contractInstance.methods
      .requestBuy(
        BigInt(itemIdx),
        myAddr,
        {
          next: {
            instance: nextInstance,
            balance: contractInstance.balance + itemPrice,
          },
        }
      )
      .then((result) => {
        console.log(`Buy request call tx: ${result.tx.id}`);
        fetchContract()
      })
      .catch((e) => {
        console.error("Buy request call error: ", e);
      });
  }

  const handleBuyConfirm = async (itemIdx: number) => {
    const signer = signerRef.current as PandaSigner;

    await contractInstance.connect(signer);

    // Fetch ordinal TX and extract UTXO.
    const outpoint = contractInstance.items[itemIdx].outpoint
    const ordinalTxid = reverseByteString(slice(outpoint, 0n, 32n), 32n)
    const ordinalVout = Number(byteString2Int(slice(outpoint, 32n, 36n)))

    const tx = await signer.provider!.getTransaction(ordinalTxid)
    const out = tx.outputs[ordinalVout]

    const ordinalUTXO: UTXO = {
      address: contractInstance.items[itemIdx].sellerAddr,
      txId: ordinalTxid,
      outputIndex: ordinalVout,
      script: out.script.toHex(),
      satoshis: out.satoshis,
    }


    //const ordinalInstance = await OrdiNFTP2PKH.getLatestInstance(ordinalTxid.toString() + ordinalVout.toString());
    //console.log(ordinalInstance.utxo)
    //
    //const ordinalUTXO = ordinalInstance.utxo

    // Create the next instance from the current.
    const nextInstance = contractInstance.next();

    // Bind custom call tx builder
    contractInstance.bindTxBuilder(
      'confirmBuy',
      async (
        current: OrdinalMarket,
        options: MethodCallOptions<OrdinalMarket>
      ) => {
        const unsignedTx: bsv.Transaction = new bsv.Transaction()

        // Add input that unlocks ordinal UTXO.
        unsignedTx
          .addInput(
            new bsv.Transaction.Input({
              prevTxId: ordinalUTXO.txId,
              outputIndex: ordinalUTXO.outputIndex,
              script: bsv.Script.fromHex('00'.repeat(34)), // Dummy script
            }),
            bsv.Script.fromHex(ordinalUTXO.script),
            ordinalUTXO.satoshis
          )
          .addInput(current.buildContractInput())

        // Build ordinal destination output.
        unsignedTx
          .addOutput(
            new bsv.Transaction.Output({
              script: bsv.Script.fromHex(
                Utils.buildPublicKeyHashScript(
                  current.items[itemIdx].requestingBuyer
                )
              )
              ,
              satoshis: 1,
            })
          )
          // Build seller payment output.
          .addOutput(
            new bsv.Transaction.Output({
              script: bsv.Script.fromHex(
                Utils.buildPublicKeyHashScript(
                  current.items[itemIdx].sellerAddr
                )
              ),
              satoshis: current.utxo.satoshis,
            })
          )

        if (options.changeAddress) {
          unsignedTx.change(options.changeAddress)
        }

        return Promise.resolve({
          tx: unsignedTx,
          atInputIndex: 1,
          nexts: [],
        })
      }
    )

    let contractTx = await contractInstance.methods.confirmBuy(
      BigInt(itemIdx),
      {
        changeAddress: await signer.getDefaultAddress(),
        partiallySigned: true,
        exec: false, // Do not execute the contract yet, only get the created calling transaction.
      } as MethodCallOptions<OrdinalMarket>
    )

    // If we would like to broadcast, here we need to sign ordinal UTXO input.
    const sigRequest: SignatureRequest = {
      prevTxId: ordinalUTXO.txId,
      outputIndex: ordinalUTXO.outputIndex,
      inputIndex: 0,
      satoshis: ordinalUTXO.satoshis,
      address: await signer.getOrdAddress(),
      scriptHex: ordinalUTXO.script,
      sigHashType: bsv.crypto.Signature.ANYONECANPAY_SINGLE,
    }
    const signedTx = await signer.signTransaction(
      contractTx.tx,
      {
        sigRequests: [sigRequest],
        address: await signer.getOrdAddress()
      } as SignTransactionOptions
    )

    // Bind tx builder, that just simply re-uses the tx we created above.
    contractInstance.bindTxBuilder(
      'confirmBuy',
      async (
        current: OrdinalMarket,
        options: MethodCallOptions<OrdinalMarket>
      ) => {
        return Promise.resolve({
          tx: signedTx,
          atInputIndex: 1,
          nexts: [],
        })
      }
    )

    contractInstance.methods.confirmBuy(
      itemIdx,
      {
        changeAddress: await signer.getDefaultAddress(),
      } as MethodCallOptions<OrdinalMarket>
    ).then((result) => {
      console.log(`Buy confirm call tx: ${result.tx.id}`);
      fetchContract()
    }).catch((e) => {
      console.error("Buy confirm call error: ", e);
    });

  }

  const handleBuyCancel = async (itemIdx: number) => {
    const signer = signerRef.current as PandaSigner;
    await contractInstance.connect(signer);

    const itemPrice = Number(contractInstance.items[itemIdx].price)

    // Create the next instance from the current.
    const nextInstance = contractInstance.next()
    nextInstance.items[itemIdx].hasRequestingBuyer = false
    nextInstance.items[itemIdx].requestingBuyer = Addr(toByteString('0000000000000000000000000000000000000000'))


    // Bind custom call tx builder.
    contractInstance.bindTxBuilder(
      'cancelBuy',
      async (
        current: OrdinalMarket,
        options: MethodCallOptions<OrdinalMarket>
      ) => {
        const unsignedTx: bsv.Transaction = new bsv.Transaction()

        const next = options.next as StatefulNext<OrdinalMarket>

        unsignedTx
          .addInput(current.buildContractInput())
          .addOutput(
            new bsv.Transaction.Output({
              script: next.instance.lockingScript,
              satoshis: current.utxo.satoshis - itemPrice,
            })
          )
          // Build buyer refund output.
          .addOutput(
            new bsv.Transaction.Output({
              script: bsv.Script.fromHex(
                Utils.buildPublicKeyHashScript(
                  current.items[itemIdx].requestingBuyer
                )
              ),
              satoshis: itemPrice,
            })
          )

        if (options.changeAddress) {
          unsignedTx.change(options.changeAddress)
        }

        return Promise.resolve({
          tx: unsignedTx,
          atInputIndex: 0,
          nexts: [],
        })
      })

    // Call the method of current instance to apply the updates on chain.
    const myPublicKey = await signer.getDefaultPubKey()
    contractInstance.methods
      .cancelBuy(
        BigInt(itemIdx),
        PubKey(myPublicKey.toByteString()),
        (sigResps: SignatureResponse[]) => findSig(sigResps, myPublicKey),
        {
          pubKeyOrAddrToSign: myPublicKey,
          changeAddress: myPublicKey.toAddress(),
          next: {
            instance: nextInstance,
            balance: contractInstance.balance - itemPrice,
          },
        } as MethodCallOptions<OrdinalMarket>
      )
      .then((result) => {
        console.log(`Buy request call tx: ${result.tx.id}`);
        fetchContract()
      })
      .catch((e) => {
        console.error("Buy request call error: ", e);
      });
  }

  const handleCancelListing = async (itemIdx: number) => {
    const signer = signerRef.current as PandaSigner;

    const { isAuthenticated, error } = await signer.requestAuth();
    if (!isAuthenticated) {
      throw new Error(error);
    }

    await contractInstance.connect(signer)

    const seller = await signer.getOrdPubKey()
    const sellerPubKey = PubKey(seller.toByteString())

    // Create the next instance from the current.
    const nextInstance = contractInstance.next();
    nextInstance.items[itemIdx].isEmptySlot = true

    // Call the method of current instance to apply the updates on chain.
    contractInstance.methods
      .cancelListing(
        itemIdx,
        sellerPubKey,
        (sigResp) => findSig(sigResp, seller),
        {
          pubKeyOrAddrToSign: seller,
          next: {
            instance: nextInstance,
            balance: contractInstance.balance,
          },
        } as MethodCallOptions<OrdinalMarket>
      )
      .then((result) => {
        console.log(`Cancel listing call tx: ${result.tx.id}`);
        fetchContract()
      })
      .catch((e) => {
        console.error("Cancel listing call error: ", e);
      });
  }


  const handleConnect = async () => {
    const provider = new ScryptProvider();
    const signer = new PandaSigner(provider);

    signerRef.current = signer;
    const { isAuthenticated, error } = await signer.requestAuth()
    if (!isAuthenticated) {
      throw new Error(`Unauthenticated: ${error}`)
    }

    setConnectedOrdiAddress(await signer.getOrdAddress())
    setIsConnected(true)
  };

  const handleTabChange = (e, tabIndex) => {
    if (tabIndex == 0) {
      loadWalletItems()
    } else if (tabIndex == 1) {
      fetchContract()
    }
    setActiveTab(tabIndex);
  };

  return (
    <div>
      {isConnected ? (
        <div style={{ padding: '20px' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={activeTab} onChange={handleTabChange}>
              <Tab label="My NFT's" />
              <Tab label="Market" />
            </Tabs>
          </Box>
          {activeTab === 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
              {walletItems.map((item, idx) => {
                return <ItemViewWallet key={idx} item={item} idx={idx} onList={handleList} />
              })}
            </Box>
          )}
          {activeTab === 1 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center' }}>
              {contractInstance && contractInstance.items.map((item, idx) => {
                if (!item.isEmptySlot) {
                  return <ItemViewMarket
                    key={idx}
                    marketItem={item}
                    myAddr={Addr(connectedOrdiAddress.toByteString())}
                    idx={idx}
                    onBuyRequest={handleBuyRequest}
                    onBuyConfirm={handleBuyConfirm}
                    onBuyCancel={handleBuyCancel}
                    onCancel={handleCancelListing} />
                }
              })}
            </Box>
          )}
        </div>
      ) : (
        <div style={{ height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <Button variant="contained" size="large" onClick={handleConnect}>
            Connect Panda Wallet
          </Button>
        </div>
      )}
    </div>
  );
};

export default App;