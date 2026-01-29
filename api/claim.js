const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

const FAUCET_PK = process.env.FAUCET_PK;
const CLAIM_AMOUNT = 0.01;
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }
    
    if (!FAUCET_PK) {
        return res.status(500).json({ success: false, error: 'Faucet not configured' });
    }
    
    try {
        const { wallet } = req.body;
        
        // Validate wallet
        if (!wallet || wallet.length < 32 || wallet.length > 50) {
            return res.status(400).json({ success: false, error: 'Invalid wallet address' });
        }
        
        let toPubkey;
        try {
            toPubkey = new PublicKey(wallet);
        } catch {
            return res.status(400).json({ success: false, error: 'Invalid Solana address' });
        }
        
        // Initialize faucet wallet
        const secretKey = bs58.decode(FAUCET_PK);
        const faucetWallet = Keypair.fromSecretKey(secretKey);
        
        const connection = new Connection(SOLANA_RPC, 'confirmed');
        
        // Check balance
        const balance = await connection.getBalance(faucetWallet.publicKey);
        if (balance < (CLAIM_AMOUNT + 0.001) * LAMPORTS_PER_SOL) {
            return res.status(503).json({ success: false, error: 'Faucet is empty! Check back later.' });
        }
        
        // Send SOL
        const lamports = Math.floor(CLAIM_AMOUNT * LAMPORTS_PER_SOL);
        
        const transaction = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: faucetWallet.publicKey,
                toPubkey: toPubkey,
                lamports: lamports
            })
        );
        
        const signature = await sendAndConfirmTransaction(
            connection,
            transaction,
            [faucetWallet],
            { commitment: 'confirmed' }
        );
        
        console.log(`Sent ${CLAIM_AMOUNT} SOL to ${wallet} - TX: ${signature}`);
        
        return res.status(200).json({ success: true, txHash: signature });
        
    } catch (err) {
        console.error('Claim error:', err.message);
        return res.status(500).json({ success: false, error: 'Transaction failed. Try again.' });
    }
};
