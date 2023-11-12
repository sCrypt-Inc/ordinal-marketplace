import {
    method,
    prop,
    SmartContract,
    hash256,
    assert,
    ByteString,
    FixedArray,
    toByteString,
    fill,
    PubKeyHash,
    Utils,
    Addr,
    Sig,
    slice,
    PubKey,
    hash160
} from 'scrypt-ts'

export type Item = {
    outpoint: ByteString
    price: bigint
    sellerAddr: Addr
    isEmptySlot: boolean
    hasRequestingBuyer: boolean
    requestingBuyer: Addr
}


export class OrdinalMarket extends SmartContract {

    static readonly ITEM_SLOTS = 10

    @prop(true)
    items: FixedArray<Item, typeof OrdinalMarket.ITEM_SLOTS>

    constructor() {
        super(...arguments)
        this.items = fill(
            {
                outpoint: toByteString(''),
                price: 0n,
                sellerAddr: Addr(toByteString('0000000000000000000000000000000000000000')),
                isEmptySlot: true,
                hasRequestingBuyer: false,
                requestingBuyer: Addr(toByteString('0000000000000000000000000000000000000000')),
            },
            OrdinalMarket.ITEM_SLOTS
        )
    }

    @method()
    public listItem(item: Item, itemIdx: bigint) {
        assert(this.items[Number(itemIdx)].isEmptySlot, 'item slot not empty')
        assert(!item.isEmptySlot, 'new item cannot have the "isEmptySlot" flag set to true')
        assert(item.price > 0n, 'item price must be at least one satoshi')
        assert(!item.hasRequestingBuyer, 'new item cannot have requesting buyer flag set to true')

        this.items[Number(itemIdx)] = item

        let outputs = this.buildStateOutput(this.ctx.utxo.value)
        outputs += this.buildChangeOutput()
        assert(hash256(outputs) == this.ctx.hashOutputs, 'hashOutputs mismatch')
    }
    
    
    @method()
    public requestBuy(itemIdx: bigint, buyerAddr: Addr) {
        assert(!this.items[Number(itemIdx)].isEmptySlot, 'item slot empty')

        const item = this.items[Number(itemIdx)]
        
        this.items[Number(itemIdx)].hasRequestingBuyer = true
        this.items[Number(itemIdx)].requestingBuyer = buyerAddr
        
        // Make sure buyer made deposit to smart contract.
        let outputs = this.buildStateOutput(this.ctx.utxo.value + item.price)
        outputs += this.buildChangeOutput()
        assert(hash256(outputs) == this.ctx.hashOutputs, 'hashOutputs mismatch')
    }

    @method()
    public confirmBuy(itemIdx: bigint) {
        assert(!this.items[Number(itemIdx)].isEmptySlot, 'item slot empty')

        const item = this.items[Number(itemIdx)]
        
        this.items[Number(itemIdx)].hasRequestingBuyer = false
        this.items[Number(itemIdx)].requestingBuyer = PubKeyHash(toByteString('0000000000000000000000000000000000000000'))
        
        // Make sure first input unlocks ordinal.
        assert(
            slice(this.prevouts, 0n, 36n) == item.outpoint,
            'first input is not spending specified ordinal UTXO'
        )
        
        // First output will transfer the ordinal to the buyer.
        let outputs = Utils.buildPublicKeyHashOutput(item.requestingBuyer, 1n)
        
        // Second output will be the marketplace contract itself.
        outputs = this.buildStateOutput(this.ctx.utxo.value - item.price)
        
        // Third output pays the seller
        outputs += Utils.buildPublicKeyHashOutput(item.sellerAddr, item.price)
        
        // Handle change and check outputs.
        outputs += this.buildChangeOutput()
        assert(hash256(outputs) == this.ctx.hashOutputs, 'hashOutputs mismatch')
    }

    @method()
    public cancelBuy(itemIdx: bigint, buyerPubKey: PubKey, buyerSig: Sig) {
        assert(!this.items[Number(itemIdx)].isEmptySlot, 'item slot empty')
        
        const item = this.items[Number(itemIdx)]

        // Check buyer pubkey and sig.
        assert(hash160(buyerPubKey) == item.requestingBuyer, 'buyer invalid pubkey')
        assert(this.checkSig(buyerSig, buyerPubKey), 'buyer sig invalid')
        
        this.items[Number(itemIdx)].hasRequestingBuyer = false
        this.items[Number(itemIdx)].requestingBuyer = Addr(toByteString('0000000000000000000000000000000000000000'))
        
        // Subtract buyers deposit from contract and refund his address.
        let outputs = this.buildStateOutput(this.ctx.utxo.value - item.price)
        outputs += Utils.buildPublicKeyHashOutput(hash160(buyerPubKey), item.price)
        outputs += this.buildChangeOutput()
        
        assert(hash256(outputs) == this.ctx.hashOutputs, 'hashOutputs mismatch')
    }
    
    @method()
    public cancelListing(itemIdx: bigint, sellerPubKey: PubKey, sellerSig: Sig) {
        assert(!this.items[Number(itemIdx)].isEmptySlot, 'item slot empty')
        
        const item = this.items[Number(itemIdx)]

        // Check seller pubkey and sig.
        assert(hash160(sellerPubKey) == item.sellerAddr, 'seller invalid pubkey')
        assert(this.checkSig(sellerSig, sellerPubKey), 'seller sig invalid')
        
        this.items[Number(itemIdx)].isEmptySlot = true
        
        // Subtract buyers deposit from contract and refund his address.
        let outputs = this.buildStateOutput(this.ctx.utxo.value)
        outputs += this.buildChangeOutput()
        
        assert(hash256(outputs) == this.ctx.hashOutputs, 'hashOutputs mismatch')
    }

}