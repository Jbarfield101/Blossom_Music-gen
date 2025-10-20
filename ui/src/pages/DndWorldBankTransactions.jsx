import { useEffect, useMemo, useState } from 'react';
import BackButton from '../components/BackButton.jsx';
import { getConfig, setConfig } from '../api/config';
import './Dnd.css';

export default function DndWorldBankTransactions() {
  const [localPlayer, setLocalPlayer] = useState('');
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [balances, setBalances] = useState({});
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('gold');
  const [note, setNote] = useState('');
  const [ledger, setLedger] = useState([]);
  const [filterPlayer, setFilterPlayer] = useState('');
  const [filterCurrency, setFilterCurrency] = useState('');

  const recomputeBalances = (entries) => {
    const summary = {};
    entries.forEach((entry) => {
      if (!entry?.player || !entry?.currency) return;
      const direction = entry.direction === 'withdraw' ? -1 : 1;
      const value = Number(entry.amount) || 0;
      if (!summary[entry.player]) {
        summary[entry.player] = { gold: 0, silver: 0, bronze: 0 };
      }
      const current = Number(summary[entry.player][entry.currency] || 0);
      const total = current + direction * value;
      summary[entry.player][entry.currency] = Math.max(0, total);
    });
    return summary;
  };

  useEffect(() => {
    (async () => {
      let loadedLedger = [];
      try {
        const storedLedger = await getConfig('bankLedger');
        if (Array.isArray(storedLedger)) {
          loadedLedger = storedLedger.filter((entry) => entry && entry.player && entry.currency);
        }
      } catch {
        loadedLedger = [];
      }

      try {
        const stored = await getConfig('bankBalances');
        const fallback = typeof stored === 'object' && stored ? stored : {};
        if (loadedLedger.length) {
          setBalances(recomputeBalances(loadedLedger));
        } else {
          setBalances(fallback);
        }
      } catch {
        if (loadedLedger.length) {
          setBalances(recomputeBalances(loadedLedger));
        } else {
          setBalances({});
        }
      }

      try {
        const raw = localStorage.getItem('dnd.player.current');
        const current = raw ? JSON.parse(raw) : null;
        if (current?.name) {
          setLocalPlayer(current.name);
        } else {
          setLocalPlayer('');
        }
      } catch {
        setLocalPlayer('');
      }

      setLedger(loadedLedger);
    })();
  }, []);

  useEffect(() => {
    if (ledger.length) {
      setBalances(recomputeBalances(ledger));
    }
  }, [ledger]);

  const playerOptions = useMemo(() => {
    const names = new Set();
    if (localPlayer) names.add(localPlayer);
    Object.keys(balances || {}).forEach((name) => names.add(name));
    ledger.forEach((entry) => {
      if (entry?.player) names.add(entry.player);
    });
    return Array.from(names);
  }, [balances, ledger, localPlayer]);

  useEffect(() => {
    if (!playerOptions.length) {
      if (selectedPlayer) setSelectedPlayer('');
      return;
    }
    if (!selectedPlayer || !playerOptions.includes(selectedPlayer)) {
      setSelectedPlayer(playerOptions[0]);
    }
  }, [playerOptions, selectedPlayer]);

  useEffect(() => {
    if (filterPlayer && !playerOptions.includes(filterPlayer)) {
      setFilterPlayer('');
    }
  }, [filterPlayer, playerOptions]);

  const bal = balances[selectedPlayer] || { gold: 0, silver: 0, bronze: 0 };

  const applyTx = async (sign) => {
    const amt = Math.max(0, Number(amount || 0));
    if (!selectedPlayer || !amt) return;
    const entry = {
      player: selectedPlayer,
      currency,
      amount: amt,
      note: note.trim(),
      direction: sign > 0 ? 'deposit' : 'withdraw',
      timestamp: new Date().toISOString(),
    };
    const nextLedger = [...ledger, entry];
    const nextBalances = recomputeBalances(nextLedger);
    setLedger(nextLedger);
    setBalances(nextBalances);
    setAmount('');
    setNote('');
    try {
      await Promise.all([
        setConfig('bankLedger', nextLedger),
        setConfig('bankBalances', nextBalances),
      ]);
    } catch {}
  };

  const currencyOptions = ['gold', 'silver', 'bronze'];

  const filteredLedger = useMemo(() => {
    const list = [...ledger];
    list.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    return list.filter((entry) => {
      if (filterPlayer && entry.player !== filterPlayer) return false;
      if (filterCurrency && entry.currency !== filterCurrency) return false;
      return true;
    });
  }, [filterCurrency, filterPlayer, ledger]);

  const renderNote = (entryNote) => {
    if (!entryNote) return '—';
    const trimmed = entryNote.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return <a href={trimmed} target="_blank" rel="noreferrer">{trimmed}</a>;
    }
    return trimmed;
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
                {playerOptions.length === 0 ? <option value="">(no players)</option> : playerOptions.map((p) => (
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
                {currencyOptions.map((cur) => (
                  <option key={cur} value={cur}>{cur.charAt(0).toUpperCase() + cur.slice(1)}</option>
                ))}
              </select>
            </label>
            <label style={{ flex: '1 1 280px' }}>
              <span>Note</span>
              <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Quest payout, shop purchase…" />
            </label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" onClick={() => applyTx(+1)} disabled={!selectedPlayer || Number(amount) <= 0}>Deposit</button>
              <button type="button" onClick={() => applyTx(-1)} disabled={!selectedPlayer || Number(amount) <= 0}>Withdraw</button>
            </div>
          </div>
          <p className="muted" style={{ marginTop: '0.5rem' }}>Balances derive from the ledger and persist to settings automatically.</p>
        </section>

        <section className="dnd-surface" aria-labelledby="bank-ledger-heading">
          <h2 id="bank-ledger-heading">Ledger</h2>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <label>
              <span>Filter by player</span>
              <select value={filterPlayer} onChange={(e) => setFilterPlayer(e.target.value)}>
                <option value="">All players</option>
                {playerOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Filter by currency</span>
              <select value={filterCurrency} onChange={(e) => setFilterCurrency(e.target.value)}>
                <option value="">All currencies</option>
                {currencyOptions.map((cur) => (
                  <option key={cur} value={cur}>{cur.charAt(0).toUpperCase() + cur.slice(1)}</option>
                ))}
              </select>
            </label>
          </div>
          {filteredLedger.length === 0 ? (
            <p className="muted">No transactions recorded yet. Add deposits or withdrawals to build a history.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Timestamp</th>
                    <th scope="col">Player</th>
                    <th scope="col">Currency</th>
                    <th scope="col">Amount</th>
                    <th scope="col">Direction</th>
                    <th scope="col">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLedger.map((entry, idx) => (
                    <tr key={`${entry.timestamp}-${idx}`}>
                      <td>{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}</td>
                      <td>{entry.player}</td>
                      <td>{entry.currency}</td>
                      <td>{entry.amount}</td>
                      <td>{entry.direction}</td>
                      <td>{renderNote(entry.note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </>
  );
}
