import { useEffect, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig, setConfig } from '../api/config';
import './Dnd.css';

export default function DndWorldBankTransactions() {
  const [players, setPlayers] = useState([]);
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [balances, setBalances] = useState({});
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('gold');
  const [note, setNote] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const stored = await getConfig('bankBalances');
        setBalances(typeof stored === 'object' && stored ? stored : {});
      } catch {
        setBalances({});
      }
      try {
        const raw = localStorage.getItem('dnd.player.current');
        const current = raw ? JSON.parse(raw) : null;
        const list = [];
        if (current?.name) list.push(current.name);
        setPlayers(list);
        setSelectedPlayer(list[0] || '');
      } catch {
        setPlayers([]);
      }
    })();
  }, []);

  const bal = balances[selectedPlayer] || { gold: 0, silver: 0, bronze: 0 };

  const applyTx = async (sign) => {
    const amt = Math.max(0, Number(amount || 0));
    if (!selectedPlayer || !amt) return;
    const next = { ...balances };
    const cur = { ...(next[selectedPlayer] || { gold: 0, silver: 0, bronze: 0 }) };
    cur[currency] = Math.max(0, Number(cur[currency] || 0) + sign * amt);
    next[selectedPlayer] = cur;
    setBalances(next);
    setAmount('');
    setNote('');
    try { await setConfig('bankBalances', next); } catch {}
  };

  return (
    <>
      <BackButton />
      <h1>Dungeons & Dragons · Bank Transactions</h1>
      <section className="dashboard" style={{ display: 'grid', gap: 'var(--space-lg)' }}>
        <section className="dnd-surface" aria-labelledby="bank-balance-heading">
          <h2 id="bank-balance-heading">Balances</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              <span>Player</span>
              <select value={selectedPlayer} onChange={(e) => setSelectedPlayer(e.target.value)}>
                {players.length === 0 ? <option value="">(no players)</option> : players.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <div className="muted">Current Balance:</div>
            <strong>{bal.gold || 0} gold</strong>
            <strong>{bal.silver || 0} silver</strong>
            <strong>{bal.bronze || 0} bronze</strong>
          </div>
        </section>

        <section className="dnd-surface" aria-labelledby="bank-tx-heading">
          <h2 id="bank-tx-heading">New Transaction</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label>
              <span>Amount</span>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="0" />
            </label>
            <label>
              <span>Currency</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="gold">Gold</option>
                <option value="silver">Silver</option>
                <option value="bronze">Bronze</option>
              </select>
            </label>
            <label style={{ flex: '1 1 280px' }}>
              <span>Note</span>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Quest payout, shop purchase…" />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={() => applyTx(+1)}>Deposit</button>
              <button type="button" onClick={() => applyTx(-1)}>Withdraw</button>
            </div>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem' }}>Balances persist to settings; full ledger coming soon.</p>
        </section>
      </section>
    </>
  );
}
