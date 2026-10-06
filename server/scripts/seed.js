// Creates (or updates) the owner account. There is no sign-up and no OTP in ReelVault.
//
//   npm run seed                       (reads SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD from the environment)
//   npm run seed -- you@example.com    (password is then read from SEED_OWNER_PASSWORD)
//
// Re-running it with a new password resets the password for that email.
import mongoose from 'mongoose';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const email = (process.argv[2] || process.env.SEED_OWNER_EMAIL || '').trim().toLowerCase();
const password = process.env.SEED_OWNER_PASSWORD || '';
const name = process.env.SEED_OWNER_NAME || 'Akash Singh';

const fail = (msg) => { console.error(`Seed failed: ${msg}`); process.exit(1); };

if (!process.env.MONGODB_URI) fail('MONGODB_URI is not set');
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('set SEED_OWNER_EMAIL to a valid email');
if (password.length < 10) fail('SEED_OWNER_PASSWORD must be at least 10 characters');

await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
const existing = await User.findOne({ email });
await User.updateOne({ email }, { $set: { email, name, passwordHash: hashPassword(password) } }, { upsert: true });
console.log(existing ? `Updated owner account: ${email}` : `Created owner account: ${email}`);
await mongoose.disconnect();
