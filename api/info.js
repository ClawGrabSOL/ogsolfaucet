const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

const FAUCET_PK = process.env.FAUCET_PK;
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    let balance = 0;
    let wallet = '';
    
    if (FAUCET_PK) {
        try {
            const secretKey = bs58.decode(FAUCET_PK);
            const faucetWallet = Keypair.fromSecretKey(secretKey);
            wallet = faucetWallet.publicKey.toString();
            
            const connection = new Connection(SOLANA_RPC, 'confirmed');
            const bal = await connection.getBalance(faucetWallet.publicKey);
            balance = bal / LAMPORTS_PER_SOL;
        } catch (err) {
            console.error('Error:', err.message);
        }
    }
    
    res.json({
        balance,
        wallet,
        claimAmount: 0.01,
        totalClaims: 0,
        totalSent: 0,
        recentClaims: []
    });
};
