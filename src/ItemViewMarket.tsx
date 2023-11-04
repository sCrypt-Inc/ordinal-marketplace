import React, { useEffect, useState } from 'react';
import { Button, Card, CardContent, Typography } from '@mui/material';

interface ItemProps {
  marketItem: any
  idx: number
  isMyListing: boolean
  onBuy: (marketItem: any) => void;
  onCancel: (marketItem: any) => void;
}

const ItemViewMarket: React.FC<ItemProps> = ({ marketItem, idx, isMyListing, onBuy, onCancel }) => {
  const [textData, setTextData] = useState<string | null>(null);

  useEffect(() => {
    if (marketItem.item.origin.data.insc.file.type === 'text/plain') {
      const url = `https://testnet.ordinals.gorillapool.io/content/${marketItem.item.origin.outpoint}`;
      fetch(url)
        .then(response => response.text())
        .then(data => setTextData(data))
        .catch(error => console.error('Error fetching text data:', error));
    }
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
        {marketItem.item.origin.data.insc.file.type.startsWith('image/') && (
          <img style={{ maxWidth: 250 }} src={`https://testnet.ordinals.gorillapool.io/content/${marketItem.item.origin.outpoint}`} alt={`Content #${marketItem.item.origin.num}`} />
        )}
        {marketItem.item.origin.data.insc.file.type === 'text/plain' && (
          <Typography variant="h5" component="div">
            {textData || 'Loading text...'}
          </Typography>
        )}
        {marketItem.origin.num ? (
          <Typography variant="body2" color="text.secondary">
            #{marketItem.origin.num}
          </Typography>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Pending...
          </Typography>
        )}
        <Typography variant="body2" color="text.secondary">
          <b>Price:</b> {marketItem.price / (10**8)} BSV
        </Typography>
        { isMyListing ? (
          <Button variant="contained" onClick={() => onCancel(marketItem)}>Cancel</Button>
        ) : (
          <Button variant="contained" onClick={() => onBuy(marketItem)}>Buy</Button>
        )}
      </CardContent>
    </Card>
  );
};

export default ItemViewMarket;