const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3004;

// === CONFIGURATION ===
const FAUCET_PRIVATE_KEY = process.env.FAUCET_PK; // Base58 private key
const CLAIM_AMOUNT = 0.01; // SOL per claim
const COOLDOWN_HOURS = 24; // Hours between claims per wallet

// Solana
const { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58 = require('bs58');

const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(SOLANA_RPC, 'confirmed');

let faucetWallet = null;
let faucetPublicKey = '';

// Stats & rate limiting
let stats = {
    totalClaims: 0,
    totalSent: 0,
    recentClaims: []
};

const claimHistory = new Map(); // wallet -> timestamp

// Initialize faucet wallet
function initWallet() {
    if (!FAUCET_PRIVATE_KEY) {
        console.log('⚠️  No FAUCET_PK environment variable set');
        return false;
    }
    
    try {
        const secretKey = bs58.decode(FAUCET_PRIVATE_KEY);
        faucetWallet = Keypair.fromSecretKey(secretKey);
        faucetPublicKey = faucetWallet.publicKey.toString();
        console.log('✅ Faucet wallet initialized:', faucetPublicKey);
        return true;
    } catch (err) {
        console.error('❌ Failed to initialize wallet:', err.message);
        return false;
    }
}

// Get faucet balance
async function getBalance() {
    try {
        const balance = await connection.getBalance(faucetWallet.publicKey);
        return balance / LAMPORTS_PER_SOL;
    } catch (err) {
        console.error('Error getting balance:', err.message);
        return 0;
    }
}

// Send SOL
async function sendSol(toAddress) {
    try {
        const toPubkey = new PublicKey(toAddress);
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
        
        return signature;
    } catch (err) {
        console.error('Send error:', err.message);
        throw err;
    }
}

// Check if wallet can claim
function canClaim(wallet) {
    const lastClaim = claimHistory.get(wallet);
    if (!lastClaim) return { allowed: true };
    
    const hoursSince = (Date.now() - lastClaim) / (1000 * 60 * 60);
    if (hoursSince < COOLDOWN_HOURS) {
        const hoursLeft = Math.ceil(COOLDOWN_HOURS - hoursSince);
        return { allowed: false, hoursLeft };
    }
    
    return { allowed: true };
}

// HTTP Server
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
};

const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // API: Get faucet info
    if (req.url === '/api/info' && req.method === 'GET') {
        const balance = faucetWallet ? await getBalance() : 0;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            balance,
            wallet: faucetPublicKey,
            claimAmount: CLAIM_AMOUNT,
            totalClaims: stats.totalClaims,
            totalSent: stats.totalSent,
            recentClaims: stats.recentClaims.slice(-10)
        }));
        return;
    }

    // API: Claim SOL
    if (req.url === '/api/claim' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { wallet } = JSON.parse(body);
                
                // Validate wallet
                if (!wallet || wallet.length < 32 || wallet.length > 50) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Invalid wallet address' }));
                    return;
                }
                
                // Check if valid Solana address
                try {
                    new PublicKey(wallet);
                } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Invalid Solana address' }));
                    return;
                }
                
                // Check cooldown
                const { allowed, hoursLeft } = canClaim(wallet);
                if (!allowed) {
                    res.writeHead(429, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ 
                        success: false, 
                        error: `Please wait ${hoursLeft} more hours before claiming again` 
                    }));
                    return;
                }
                
                // Check faucet balance
                const balance = await getBalance();
                if (balance < CLAIM_AMOUNT + 0.001) {
                    res.writeHead(503, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: 'Faucet is empty! Check back later.' }));
                    return;
                }
                
                // Send SOL
                console.log(`💸 Sending ${CLAIM_AMOUNT} SOL to ${wallet}`);
                const txHash = await sendSol(wallet);
                
                // Update stats
                claimHistory.set(wallet, Date.now());
                stats.totalClaims++;
                stats.totalSent += CLAIM_AMOUNT;
                stats.recentClaims.push({ wallet, time: Date.now() });
                if (stats.recentClaims.length > 50) {
                    stats.recentClaims = stats.recentClaims.slice(-50);
                }
                
                console.log(`✅ Sent! TX: ${txHash}`);
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, txHash }));
                
            } catch (err) {
                console.error('Claim error:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'Transaction failed. Try again.' }));
            }
        });
        return;
    }

    // Static files
    let filePath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    filePath = path.join(__dirname, 'public', filePath);
    
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
    });
});

server.listen(PORT, () => {
    console.log(`\n🚰 SOL Faucet running at http://localhost:${PORT}`);
    console.log(`💰 Claim amount: ${CLAIM_AMOUNT} SOL`);
    console.log(`⏰ Cooldown: ${COOLDOWN_HOURS} hours\n`);
    initWallet();
});
