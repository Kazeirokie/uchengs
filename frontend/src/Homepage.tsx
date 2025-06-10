import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import lighthouse from '@lighthouse-web3/sdk';
import kavach from '@lighthouse-web3/kavach';
import abiJson from '../../artifacts/contracts/LandNFT.sol/LandNFT.json';

// Add this to declare window.ethereum for TypeScript
declare global {
  interface Window {
    ethereum?: any;
  }
}

// Constants (replace with your .env values)
const LIGHTHOUSE_API_KEY = "01eba46e.2c8d8ac61ba3451aaa26945e075c88b8";
const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const abi = abiJson.abi;
type Land = { id: string; uri: string; key: string };
type PurchaseRequest = { tokenId: string; buyer: string; previousOwner: string };

export default function ReEncrypt() {
  const [status, setStatus] = useState('Idle');
  const [oldCid, setOldCid] = useState('');
  const [encryptedCid, setEncryptedCid] = useState('');
  const [decryptedPayload, setDecryptedPayload] = useState<any>(null);
  const [lands, setLands] = useState<Land[]>([]);

  // New state for purchase flow
const [currentAccount, setCurrentAccount] = useState<string>('');
  const [purchaseRequests, setPurchaseRequests] = useState<PurchaseRequest[]>([]);

  // Metadata inputs
  const [streetNumber, setStreetNumber] = useState('');
  const [streetName, setStreetName] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');
  const [stateVal, setStateVal] = useState('');

  // Sign Kavach challenge
  async function signAuthMessage(address: string, signer: ethers.Signer): Promise<string> {
    const authResp = await kavach.getAuthMessage(address);
    if (typeof authResp.message !== 'string') throw new Error('No Kavach auth challenge found');
    return signer.signMessage(authResp.message);
  }

  // Encrypt metadata & mint NFT
  async function encryptAndMint() {
    try {
      if (!window.ethereum) throw new Error('MetaMask not found');
      setStatus('⏳ Connecting wallet…');
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      const govAddr = await signer.getAddress();

      setStatus('⏳ Signing Kavach challenge…');
      const challenge = (await kavach.getAuthMessage(govAddr)).message!;
      const signature = await signer.signMessage(challenge);

      const metadata = {
        StreetNumber: Number(streetNumber),
        StreetName: streetName,
        Region: region,
        City: city,
        State: stateVal,
        timestamp: Math.floor(Date.now() / 1000),
      };

      setStatus('⏳ Encrypting & uploading metadata…');
      const uploadResp: any = await lighthouse.textUploadEncrypted(
        JSON.stringify(metadata),
        LIGHTHOUSE_API_KEY,
        govAddr,
        signature,
        'land-metadata'
      );
      const cid = Array.isArray(uploadResp.data)
        ? uploadResp.data[0].Hash
        : uploadResp.data.Hash;
      setEncryptedCid(cid);
      setStatus(`✅ Metadata encrypted: ${cid}`);

      setStatus('⏳ Minting Land NFT…');
      
      const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
      const tx = await contract.mintLand(cid);
      await tx.wait();

      // Derive tokenId by fetching new balance and subtracting one
      const balance = await contract.balanceOf(govAddr);
      const tokenId = (balance - 1n).toString();

      setStatus(`⏳ Fetching tokenURI for ID ${tokenId}…`);
      const uri = await contract.tokenURI(tokenId);
      setLands(prev => [
        {
          id: tokenId,
          uri,
          key: crypto.randomUUID(),    // <-- unique, never duplicates
        },
        ...prev
      ]);
      setStatus(`✅ Minted Land ${tokenId} with URI ${uri}`);
      await fetchMyLands(); // refresh lands listy

    } catch (err: any) {
      console.error(err);
      if (err.code === 'CALL_EXCEPTION' && err.reason) {
        setStatus(`❌ Transaction reverted: ${err.reason}`);
      } else {
        setStatus('❌ Encrypt/Mint error: ' + (err.message || String(err)));
      }
    }
  }

  // Decrypt by CID
  async function decryptCid() {
    try {
      if (!window.ethereum) throw new Error('MetaMask not found');
      setStatus('⏳ Connecting wallet…');
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      console.log(
        "on-chain bytecode:",
        await provider.getCode(CONTRACT_ADDRESS)
      );
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();

      setStatus('⏳ Signing Kavach challenge…');
      const signature = await signAuthMessage(addr, signer);

      setStatus('⏳ Fetching decryption key…');
      const fetchResp = await lighthouse.fetchEncryptionKey(oldCid, addr, signature);
      const fileKey = fetchResp.data.key;

      setStatus('⏳ Downloading & decrypting…');
      const decryptResult = await lighthouse.decryptFile(oldCid, fileKey as string);
      let buf: ArrayBuffer;
      if (decryptResult instanceof ArrayBuffer) buf = decryptResult;
      else if (ArrayBuffer.isView(decryptResult)) buf = decryptResult.buffer;
      else if ((decryptResult as any).arrayBuffer) buf = await (decryptResult as any).arrayBuffer();
      else throw new Error('Unexpected decryptFile return');
      const payload = JSON.parse(new TextDecoder().decode(buf));
      setDecryptedPayload(payload);
      setStatus('✅ Decryption successful');
    } catch (err: any) {
      console.error(err);
      setStatus('❌ Decrypt error: ' + (err.message || String(err)));
    }
  }

    // Connect wallet, set currentAccount
  async function connectWallet() {
    if (!window.ethereum) throw new Error('MetaMask not found');
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    const provider = new ethers.BrowserProvider(window.ethereum as any);
    const signer = await provider.getSigner();
    const addr = await signer.getAddress();
    setCurrentAccount(addr);
    return { provider, signer, addr };
  }

  // Buyer requests purchase; does not transfer the NFT
  async function requestPurchase(tokenId: string) {
    try {
      setStatus(`⏳ Requesting purchase for #${tokenId}…`);
      const { provider, signer } = await connectWallet();
      const marketRead = new ethers.Contract(
        CONTRACT_ADDRESS,
        ['function ownerOf(uint256) view returns (address)'],
        provider
      );
      const prevOwner: string = await marketRead.ownerOf(tokenId);

      const market = new ethers.Contract(
        CONTRACT_ADDRESS,
        ['function requestPurchase(uint256) external'],
        signer
      );
      const tx = await market.requestPurchase(tokenId);
      await tx.wait();
      setStatus('✅ Purchase request sent!');

      setPurchaseRequests((prev) => [
        ...prev,
        { tokenId, buyer: currentAccount, previousOwner: prevOwner }
      ]);
              console.log(`Purchase request for token #${tokenId} by ${currentAccount} (previous owner: ${prevOwner})`)

    } catch (err: any) {
      console.error(err);
      setStatus('❌ requestPurchase error: ' + (err.message || String(err)));
    }
  }

  // Gov approves on-chain then transfers off-chain shards
  async function approvePurchase(tokenId: string) {
    try {
      setStatus(`⏳ Approving on-chain transfer for #${tokenId}…`);
      const { signer, addr: govAddr } = await connectWallet();
      const contract = new ethers.Contract(
        CONTRACT_ADDRESS,
        ['function approvePurchase(uint256) external'],
        signer
      );
      const tx = await contract.approvePurchase(tokenId);
      await tx.wait();
      setStatus('✅ On-chain transfer complete!');

      // fetch CID for off-chain transfer
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const nft = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
      const cid = await nft.tokenURI(tokenId);

      // off-chain shard transfer
      setStatus('⏳ Transferring shards via Kavach…');
      const sig = await signAuthMessage(govAddr, signer);
      const req = purchaseRequests.find((r) => r.tokenId === tokenId);
      if (!req) throw new Error('No local request data');
      const resp: any = await kavach.transferOwnership(
        govAddr,
        cid,
        req.buyer,
        sig,
        true
      );
      if (resp.error) throw new Error(resp.error);

      setStatus(`✅ Metadata shards transferred to ${req.buyer}`);
      setPurchaseRequests((prev) => prev.filter((r) => r.tokenId !== tokenId));
    } catch (err: any) {
      console.error(err);
      setStatus('❌ approvePurchase error: ' + (err.message || String(err)));
    }
  }

  // Fetch lands owned by current user
  // New ERC-721 on-chain enumeration
  async function fetchMyLands() {
    try {
      setStatus('⏳ Fetching your lands…');
      if (!window.ethereum) throw new Error('MetaMask not found');
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum as any);
      const signer = await provider.getSigner();
      const user = await signer.getAddress();

      const contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);

      const balanceBN = await contract.balanceOf(user);
      const balance = Number(balanceBN);
      const list: { id: string; uri: string; key: string }[] = [];
      for (let i = 0; i < balance; i++) {
        const tokenId = await contract.tokenOfOwnerByIndex(user, i);
        const uri = await contract.tokenURI(tokenId);
        list.push({ id: tokenId.toString(), uri, key: crypto.randomUUID() });
      }

      setLands(list);
      setStatus(`✅ Found ${list.length} land(s)`);
    } catch (err: any) {
      console.error(err);
      setStatus('❌ Fetch lands error: ' + (err.message || String(err)));
    }
  }

  // setup on mount
  useEffect(() => {
    if (window.ethereum) connectWallet().catch(() => {});
  }, []);

  useEffect(() => {
    let contract: ethers.Contract;
    (async () => {
      if (!window.ethereum) return;
      const { provider, signer, addr: user } = await connectWallet();
      contract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
      contract.on('Transfer', (from, to, tokenId) => {
        if (from === user || to === user) fetchMyLands().catch(console.error);
      });
    })();
    return () => { if (contract) contract.removeAllListeners('Transfer'); };
  }, []);



  return (
    <div style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h2>Land NFT Dashboard</h2>

      <section style={{ marginBottom: 24 }}>
        <h3>Encrypt & Mint New Land</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input placeholder="Street Number" value={streetNumber} onChange={e => setStreetNumber(e.target.value)} style={{ padding: 8 }} />
          <input placeholder="Street Name" value={streetName} onChange={e => setStreetName(e.target.value)} style={{ padding: 8 }} />
          <input placeholder="Region" value={region} onChange={e => setRegion(e.target.value)} style={{ padding: 8 }} />
          <input placeholder="City" value={city} onChange={e => setCity(e.target.value)} style={{ padding: 8 }} />
          <input placeholder="State" value={stateVal} onChange={e => setStateVal(e.target.value)} style={{ padding: 8 }} />
        </div>
        <button onClick={encryptAndMint} style={{ marginTop: 8, padding: '8px 16px' }}>
          Encrypt & Mint
        </button>
        {encryptedCid && <p><strong>CID:</strong> {encryptedCid}</p>}
      </section>

      <section style={{ marginBottom: 24 }}>
        <h3>Decrypt by CID</h3>
        <input
          type="text"
          placeholder="Enter CID to decrypt"
          value={oldCid}
          onChange={e => setOldCid(e.target.value)}
          style={{ width: '100%', marginBottom: 8, padding: 8 }}
        />
        <button onClick={decryptCid} style={{ padding: '8px 16px' }}>
          Decrypt
        </button>
        {decryptedPayload && (
          <pre style={{ background: '#f0f0f0', padding: 8, marginTop: 8 }}>
            {JSON.stringify(decryptedPayload, null, 2)}
          </pre>
        )}
      </section>

 {/* Available Lands & My Lands */}
      <section style={{ marginTop: 24 }}>
        <h3>Available Lands</h3>
        <button onClick={fetchMyLands}>Refresh</button>
        <ul>
          {lands
            .filter((l) => /* filter those owned by govAddress via on-chain call */ true)
            .map((land) => (
              <li key={land.key} style={{ margin: '8px 0' }}>
                <strong>#{land.id}</strong> &nbsp;
                <a href={land.uri}>{land.uri}</a> &nbsp;
                <button onClick={() => requestPurchase(land.id)}>
                  Request Purchase
                </button>
              </li>
          ))}
        </ul>

        <h3>Pending Requests (Gov only)</h3>
        <ul>
          {purchaseRequests.map((r) => (
            <li key={r.tokenId} style={{ margin: '8px 0' }}>
              Token #{r.tokenId} requested by {r.buyer} &nbsp;
              <button onClick={() => approvePurchase(r.tokenId)}>
                Approve Purchase
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p style={{ marginTop: 24 }}><strong>Status:</strong> {status}</p>
    </div>
  );
}