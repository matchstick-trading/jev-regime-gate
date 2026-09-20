import { useState, useRef } from 'react';
import type { RawBar } from './types';

interface BYODProps {
  onBars: (bars: RawBar[]) => void;
  loading: boolean;
}

export function BYOD({ onBars, loading }: BYODProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'csv' | 'paste'>('csv');
  const [pasteText, setPasteText] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bars = parseCSV(reader.result as string);
        onBars(bars);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  }

  function handlePaste() {
    setError('');
    try {
      const bars = parsePasteData(pasteText);
      onBars(bars);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse data');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors font-mono"
      >
        or bring your own data (CSV / paste)
      </button>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto mt-4 rounded-lg border border-border bg-surface/40 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50">
        <div className="flex gap-1">
          <TabButton active={tab === 'csv'} onClick={() => setTab('csv')}>Upload CSV</TabButton>
          <TabButton active={tab === 'paste'} onClick={() => setTab('paste')}>Paste Data</TabButton>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-zinc-600 hover:text-zinc-400 text-xs transition-colors"
        >
          Close
        </button>
      </div>

      <div className="p-4">
        {tab === 'csv' && (
          <div>
            <p className="text-zinc-500 text-xs mb-3">
              CSV with columns: date, open, high, low, close, volume
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={handleFile}
              disabled={loading}
              className="block w-full text-xs text-zinc-400
                file:mr-3 file:px-3 file:py-1.5 file:rounded file:border file:border-border
                file:bg-zinc-800 file:text-zinc-300 file:text-xs file:font-mono
                file:cursor-pointer file:hover:bg-zinc-700 file:transition-colors
                disabled:opacity-50"
            />
          </div>
        )}

        {tab === 'paste' && (
          <div>
            <p className="text-zinc-500 text-xs mb-3">
              Paste OHLCV data: CSV rows (date,o,h,l,c,v) or JSON array of [t,o,h,l,c,v] tuples
            </p>
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              disabled={loading}
              rows={6}
              placeholder={'date,open,high,low,close,volume\n2024-01-02,472.65,473.95,467.90,472.65,52398000'}
              className="w-full bg-zinc-900 border border-border rounded-lg px-3 py-2 text-white font-mono text-xs
                placeholder:text-zinc-700 focus:outline-none focus:ring-2 focus:ring-matchstick focus:border-matchstick
                disabled:opacity-50 resize-none transition-all"
            />
            <button
              type="button"
              onClick={handlePaste}
              disabled={loading || pasteText.trim().length === 0}
              className="mt-2 px-4 py-1.5 rounded bg-zinc-800 border border-border text-zinc-300 text-xs font-mono
                hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Classify
            </button>
          </div>
        )}

        {error && (
          <p className="mt-2 text-matchstick text-xs font-mono">{error}</p>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
        active
          ? 'bg-zinc-800 text-white'
          : 'text-zinc-500 hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}

/** Parse CSV text with header row: date,open,high,low,close,volume */
function parseCSV(text: string): RawBar[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const header = lines[0].toLowerCase().split(',').map((s) => s.trim());
  const dateIdx = header.findIndex((h) => h === 'date' || h === 'timestamp' || h === 't');
  const openIdx = header.findIndex((h) => h === 'open' || h === 'o');
  const highIdx = header.findIndex((h) => h === 'high' || h === 'h');
  const lowIdx = header.findIndex((h) => h === 'low' || h === 'l');
  const closeIdx = header.findIndex((h) => h === 'close' || h === 'c');
  const volIdx = header.findIndex((h) => h === 'volume' || h === 'vol' || h === 'v');

  if (closeIdx === -1) throw new Error('CSV must include a "close" column');

  const bars: RawBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((s) => s.trim());
    if (cols.length < 2) continue;

    const t = dateIdx >= 0 ? toEpoch(cols[dateIdx]) : i;
    const o = openIdx >= 0 ? parseFloat(cols[openIdx]) : 0;
    const h = highIdx >= 0 ? parseFloat(cols[highIdx]) : 0;
    const l = lowIdx >= 0 ? parseFloat(cols[lowIdx]) : 0;
    const c = parseFloat(cols[closeIdx]);
    const v = volIdx >= 0 ? parseFloat(cols[volIdx]) : 0;

    if (isNaN(c)) continue;
    bars.push({ t, o: o || c, h: h || c, l: l || c, c, v: v || 0 });
  }

  if (bars.length === 0) throw new Error('No valid rows found in CSV');
  return bars;
}

/** Parse pasted data: try JSON first, then CSV */
function parsePasteData(text: string): RawBar[] {
  const trimmed = text.trim();

  // JSON array of tuples: [[t,o,h,l,c,v], ...]
  if (trimmed.startsWith('[')) {
    const data = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(data)) throw new Error('Expected a JSON array');

    return (data as (number[])[]).map((row) => {
      if (!Array.isArray(row) || row.length < 6) {
        throw new Error('Each tuple must have [timestamp, open, high, low, close, volume]');
      }
      return { t: row[0], o: row[1], h: row[2], l: row[3], c: row[4], v: row[5] };
    });
  }

  // Fall back to CSV
  return parseCSV(trimmed);
}

function toEpoch(dateStr: string): number {
  const n = Number(dateStr);
  if (!isNaN(n) && n > 946684800) return n; // Already epoch seconds
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.floor(d.getTime() / 1000);
}
