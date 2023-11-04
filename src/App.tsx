// App.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Addr, PandaSigner, PubKey, UTXO, bsv, findSig } from 'scrypt-ts';
import { OneSatApis, OrdiMethodCallOptions, OrdiNFTP2PKH, OrdiProvider } from 'scrypt-ord';
import { Box, Button, Tab, Tabs } from '@mui/material';
import ItemViewWallet from './ItemViewWallet';
import { OrdinalLock } from './contracts/ordinalLock';
import ItemViewMarket from './ItemViewMarket';


const App: React.FC = () => {
  const signerRef = useRef<PandaSigner>();

  const [isConnected, setIsConnected] = useState(false)

  const [connectedOrdiAddress, setConnectedOrdiAddress] = useState(undefined)

  const [walletItems, setWalletItems] = useState([])
  const [marketItems, setMarketItems] = useState([])

  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    loadMarketItems()
  }, []);

  async function loadWalletItems() {
    const signer = signerRef.current as PandaSigner;

    if (signer) {
      try {
        const connectedOrdiAddressStr = connectedOrdiAddress.toString();
        const url = `https://testnet.ordinals.gorillapool.io/api/txos/address/${connectedOrdiAddressStr}/unspent?bsv20=false`;

        const response = await fetch(url);
        const data = await response.json();

        const filteredData = data.filter(e => e.origin.data.insc.file.type !== 'application/bsv-20')
          .filter(e => marketItems[e.origin.outpoint] == undefined);

        setWalletItems(filteredData);
      } catch (error) {
        console.error('Error fetching wallet items:', error);
      }
    }
  }

  async function loadMarketItems() {
    const marketItemsRaw = localStorage.getItem('marketItems')
    if (marketItemsRaw) {
      const marketItems = JSON.parse(marketItemsRaw)
      setMarketItems(marketItems)
    }
  }

  function storeMarketItem(ordLockTx: bsv.Transaction, price: number, seller: string, item: any) {
    let marketItems: any = localStorage.getItem('marketItems')
    if (!marketItems) {
      marketItems = {}
    } else {
      marketItems = JSON.parse(marketItems)
    }

    marketItems[item.origin.outpoint] = {
      txId: ordLockTx.id,
      vout: 0,
      price: price,
      seller: seller,
      item: item
    }

    localStorage.setItem('marketItems', JSON.stringify(marketItems));
    setMarketItems(marketItems)
  }

  function removeMarketItem(originOutpoint: string) {
    let marketItems: any = localStorage.getItem('marketItems')
    if (!marketItems) {
      marketItems = {}
    } else {
      marketItems = JSON.parse(marketItems)
    }

    delete marketItems[originOutpoint]

    localStorage.setItem('marketItems', JSON.stringify(marketItems));
    setMarketItems(marketItems)
  }

  const handleList = async (idx: number, priceSats: number) => {
    const signer = signerRef.current as PandaSigner;

    const item = walletItems[idx]
    const outpoint = item.outpoint

    // Create a P2PKH object from a UTXO.
    OneSatApis.setNetwork(bsv.Networks.testnet)
    const utxo: UTXO = await OneSatApis.fetchUTXOByOutpoint(outpoint)
    const p2pkh = OrdiNFTP2PKH.fromUTXO(utxo)

    // Construct recipient smart contract - the ordinal lock.
    const ordPublicKey = await signer.getOrdPubKey()
    const seller = PubKey(ordPublicKey.toByteString())
    const amount = BigInt(priceSats)
    const ordLock = new OrdinalLock(seller, amount)
    await ordLock.connect(signer)

    // Unlock deployed NFT and send it to the recipient ordinal lock contract.
    await p2pkh.connect(signer)

    const { tx: transferTx } = await p2pkh.methods.unlock(
      (sigResps) => findSig(sigResps, ordPublicKey),
      seller,
      {
        transfer: ordLock,
        pubKeyOrAddrToSign: ordPublicKey,
      } as OrdiMethodCallOptions<OrdiNFTP2PKH>
    );

    console.log("Transferred NFT: ", transferTx.id);

    // Store reference in local storage.
    storeMarketItem(transferTx, priceSats, seller, item)
  };

  const handleBuy = async (marketItem: any) => {
    const signer = signerRef.current as PandaSigner;
    await signer.connect()

    const tx = await signer.provider.getTransaction(marketItem.txId)
    const instance = OrdinalLock.fromTx(tx, 0)

    await instance.connect(signer)

    const buyerPublicKey = await signer.getOrdPubKey()
    
    const receiverAddr = Addr(buyerPublicKey.toAddress().toByteString())
    
    const callRes = await instance.methods.purchase(
      receiverAddr
    )

    console.log("Purchase call: ", callRes.tx.id);

    // Remove market item.
    removeMarketItem(marketItem.item.origin.outpoint)
  }

  const handleCancel = async (marketItem: any) => {
    const signer = signerRef.current as PandaSigner;
    await signer.connect()

    const tx = await signer.provider.getTransaction(marketItem.txId)
    const instance = OrdinalLock.fromTx(tx, 0)

    await instance.connect(signer)

    const sellerPublicKey = await signer.getOrdPubKey()

    const callRes = await instance.methods.cancel(
      (sigResps) => findSig(sigResps, sellerPublicKey),
      {
        pubKeyOrAddrToSign: sellerPublicKey,
      } as OrdiMethodCallOptions<OrdinalLock>
    )

    console.log("Cancel call: ", callRes.tx.id);

    // Remove market item.
    removeMarketItem(marketItem.item.origin.outpoint)
  }

  const handleConnect = async () => {
    const provider = new OrdiProvider(bsv.Networks.testnet);
    const signer = new PandaSigner(provider);

    signerRef.current = signer;
    const { isAuthenticated, error } = await signer.requestAuth()
    if (!isAuthenticated) {
      throw new Error(`Unauthenticated: ${error}`)
    }

    setConnectedOrdiAddress(await signer.getOrdAddress())
    setIsConnected(true)
    loadWalletItems()
  };

  const handleTabChange = (e, tabIndex) => {
    if (tabIndex == 0) {
      loadWalletItems()
    } else if (tabIndex == 1) {
      loadMarketItems()
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
              {Object.entries(marketItems).map(([key, val], idx) => {
                const isMyListing = val.item.owner == connectedOrdiAddress.toString()
                return <ItemViewMarket key={key} marketItem={val} isMyListing={isMyListing} idx={idx} onBuy={handleBuy} onCancel={handleCancel} />
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