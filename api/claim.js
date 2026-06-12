// SPCX Faucet — pre-market allocation claim endpoint.
// Records claims in-memory per-instance (replace with persistent store for prod).
// Returns an allocation amount + a mock signature until wired to a real SPL transfer.

const claims = Object.create(null);   // wallet -> { ts, rank }
const ipClaims = Object.create(null); // ip -> ts
let claimOrder = 0;

const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h per wallet (one claim, with a soft retry window)
const IP_COOLDOWN_MS = 60 * 60 * 1000;    // 1h per IP

function validWallet(s){
  return typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

function pickAllocation(){
  // Deterministic-ish tiered allocation. Adjust to taste.
  const tiers = [
    { weight: 60, amount: 1000 },
    { weight: 25, amount: 2500 },
    { weight: 10, amount: 5000 },
    { weight: 4,  amount: 10000 },
    { weight: 1,  amount: 25000 },
  ];
  let r = Math.random() * 100;
  for (const t of tiers){
    if (r < t.weight) return t.amount;
    r -= t.weight;
  }
  return 1000;
}

function mockSignature(){
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let s = '';
  for (let i = 0; i < 88; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'METHOD NOT ALLOWED' }); return; }

  const body = req.body || {};
  const wallet = (body.wallet || '').trim();

  if (!validWallet(wallet)) {
    return res.status(400).json({ error: 'Invalid Solana wallet address' });
  }

  const now = Date.now();
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim();

  if (claims[wallet] && now - claims[wallet].ts < COOLDOWN_MS){
    const remHr = Math.ceil((COOLDOWN_MS - (now - claims[wallet].ts)) / 3600000);
    return res.status(429).json({
      error: `Wallet already claimed. Cooldown: ${remHr}h.`,
      rank: claims[wallet].rank,
      amount: claims[wallet].amount,
    });
  }

  if (ipClaims[ip] && now - ipClaims[ip] < IP_COOLDOWN_MS){
    const remMin = Math.ceil((IP_COOLDOWN_MS - (now - ipClaims[ip])) / 60000);
    return res.status(429).json({ error: `Too many claims from this network. Try again in ${remMin} min.` });
  }

  claimOrder += 1;
  const allocation = pickAllocation();
  claims[wallet] = { ts: now, rank: claimOrder, amount: allocation };
  ipClaims[ip] = now;

  return res.status(200).json({
    success: true,
    wallet,
    amount: allocation.toLocaleString('en-US'),
    rank: `#${claimOrder}`,
    signature: mockSignature(),
    snapshot: 'PENDING_LAUNCH',
    message: `Pre-market allocation of ${allocation.toLocaleString('en-US')} SPCX recorded for ${wallet}.`,
  });
};
