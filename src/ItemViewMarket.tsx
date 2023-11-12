import React, { useEffect, useState } from 'react';
import { Button, Card, CardContent, Typography } from '@mui/material';
import { Item } from './contracts/ordinalsMarket';
import { Inscription, OneSatApis, OrdiNFTP2PKH } from 'scrypt-ord';
import { Addr, ByteString, UTXO, byteString2Int, reverseByteString, slice } from 'scrypt-ts';

interface ItemProps {
  marketItem: Item
  idx: number
  myAddr: Addr
  onBuyRequest: (itemIdx: number) => void;
  onBuyConfirm: (itemIdx: number) => void;
  onBuyCancel: (itemIdx: number) => void;
  onCancel: (itemIdx: number) => void;
}

function outpointToString(outpoint: ByteString): string {
  const txId = reverseByteString(slice(outpoint, 0n, 32n), 32n)
  const vout = byteString2Int(slice(outpoint, 32n, 36n))
  return `${txId}_${vout.toString()}`
}

const ItemViewMarket: React.FC<ItemProps> = ({ marketItem, idx, myAddr, onBuyRequest, onBuyConfirm, onBuyCancel, onCancel }) => {
  const [fileType, setFileType] = useState<string | null>(null);
  const [textData, setTextData] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [isMyListing, setIsMyListing] = useState<boolean>(false);


  useEffect(() => {
    const url = `https://testnet.ordinals.gorillapool.io/api/inscriptions/${outpointToString(marketItem.outpoint)}`

    fetch(url)
      .then(response => response.json())
      .then(data => {
        setOrigin(data.origin.outpoint)
        setFileType(data.origin.data.insc.file.type)
        if (fileType == 'text/plain') {
          setTextData(data.origin.data.insc.text)
        }
      })
      .catch(error => console.error('Error fetching data:', error));

    setIsMyListing(marketItem.sellerAddr == myAddr)
  }, [marketItem]);



  return (
    <Card sx={
      {
        width: 350,
        height: 400,
        m: 2,
      }}>
      <CardContent style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        width: '90%',
        height: '90%',
      }}>
        {fileType && fileType.startsWith('image/') && (
          <img style={{ maxWidth: 250 }} src={`https://testnet.ordinals.gorillapool.io/content/${origin}`} />
        )}
        {fileType && fileType === 'text/plain' && (
          <Typography variant="h5" component="div">
            {textData}
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          <b>Price:</b> {Number(marketItem.price) / (10 ** 8)} BSV
        </Typography>
        {isMyListing ? (
          marketItem.hasRequestingBuyer ? (
            <Button variant="contained" onClick={() => onBuyConfirm(idx)}>Confirm Buy Request</Button>
          ) : (
            <Button variant="contained" onClick={() => onCancel(idx)}>Cancel Listing</Button>
          )
        ) : (
          marketItem.hasRequestingBuyer && marketItem.requestingBuyer == myAddr ? (
            <Button variant="contained" onClick={() => onBuyCancel(idx)}>Cancel Buy Request</Button>
          ) : (
            <Button variant="contained" onClick={() => onBuyRequest(idx)}>Request Buy</Button>
          )
        )}
      </CardContent>
    </Card>
  );
};

export default ItemViewMarket;