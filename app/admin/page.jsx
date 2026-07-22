'use client';

import { useEffect, useState } from 'react';

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [state, setState] = useState(null);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [uploadMsg, setUploadMsg] = useState('');
  const [publishMsg, setPublishMsg] = useState('');

  async function loadState() {
    const res = await fetch('/api/admin/state');
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    const data = await res.json();
    setState(data);
    setAuthed(true);
  }

  useEffect(() => {
    loadState();
  }, []);

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError('');
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json();
      setLoginError(body.error || 'Login failed.');
      return;
    }
    loadState();
  }

  async function handleUpload(e) {
    e.preventDefault();
    const file = e.target.file.files[0];
    if (!file) return;
    setUploadMsg('Uploading and scanning...');
    const form = new FormData();
    form.append('file', file);
    const res = await fetch('/api/admin/upload', { method: 'POST', body: form });
    const body = await res.json();
    if (!res.ok) {
      setUploadMsg('Error: ' + body.error);
      return;
    }
    setUploadMsg(`Found ${body.newCount} new vehicle(s) not currently in the tool.`);
    loadState();
  }

  async function handlePublish() {
    setPublishMsg('Publishing...');
    const res = await fetch('/api/admin/publish', { method: 'POST' });
    const body = await res.json();
    if (!res.ok) {
      setPublishMsg('Error: ' + body.error);
      return;
    }
    setPublishMsg('Published. The live BM tools will pick this up on next load.');
    loadState();
  }

  async function handleDiscardVehicle(brand, adg) {
    if (!confirm('Discard this vehicle? It will not be suggested again on future uploads unless you restore it from the ignored list.')) {
      return;
    }
    await fetch('/api/admin/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, adg }),
    });
    if (selectedVehicle?.adg === adg) setSelectedVehicle(null);
    loadState();
  }

  async function handleClearBrand(brand, count) {
    if (!confirm(`Discard all ${count} pending vehicle(s) for ${brand}? None will be suggested again unless restored from the ignored list.`)) {
      return;
    }
    await fetch('/api/admin/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand, clearAll: true }),
    });
    setSelectedBrand(null);
    setSelectedVehicle(null);
    loadState();
  }

  async function handleUnignore(adg) {
    await fetch('/api/admin/pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unignoreAdg: adg }),
    });
    loadState();
  }

  if (!authed) {
    return (
      <div style={styles.page}>
        <form onSubmit={handleLogin} style={styles.loginBox}>
          <h1 style={styles.h1}>Complete Care Admin</h1>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
          <button type="submit" style={styles.button}>Log in</button>
          {loginError && <p style={styles.error}>{loginError}</p>}
        </form>
      </div>
    );
  }

  if (!state) return <div style={styles.page}>Loading...</div>;

  const pendingBrands = Object.keys(state.pending || {}).filter(
    (b) => (state.pending[b] || []).length > 0
  );
  const totalPending = pendingBrands.reduce((sum, b) => sum + state.pending[b].length, 0);

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Complete Care Admin</h1>

      <section style={styles.card}>
        <h2 style={styles.h2}>1. Upload weekly vehicle sheet</h2>
        <form onSubmit={handleUpload}>
          <input type="file" name="file" accept=".xlsx,.xls" />
          <button type="submit" style={styles.button}>Scan for new vehicles</button>
        </form>
        {uploadMsg && <p style={styles.msg}>{uploadMsg}</p>}
      </section>

      <section style={styles.card}>
        <h2 style={styles.h2}>
          2. Pending vehicles ({totalPending} awaiting categorization)
        </h2>
        {pendingBrands.length === 0 && <p>Nothing pending.</p>}
        <div style={styles.brandGrid}>
          {pendingBrands.map((brand) => (
            <button
              key={brand}
              style={{
                ...styles.brandButton,
                ...(selectedBrand === brand ? styles.brandButtonActive : {}),
              }}
              onClick={() => {
                setSelectedBrand(brand);
                setSelectedVehicle(null);
              }}
            >
              {brand} ({state.pending[brand].length})
            </button>
          ))}
        </div>

        {selectedBrand && (
          <div>
            <div style={styles.brandActionRow}>
              <button
                style={styles.discardAllButton}
                onClick={() => handleClearBrand(selectedBrand, state.pending[selectedBrand].length)}
              >
                Discard all {state.pending[selectedBrand].length} pending for {selectedBrand}
              </button>
            </div>
            <div style={styles.vehicleList}>
              {state.pending[selectedBrand].map((v) => (
                <div key={v.adg} style={styles.vehicleRow}>
                  <button
                    style={{
                      ...styles.vehicleButton,
                      ...(selectedVehicle?.adg === v.adg ? styles.vehicleButtonActive : {}),
                    }}
                    onClick={() => setSelectedVehicle(v)}
                  >
                    {v.desc || v.adg} — ADG {v.adg}
                  </button>
                  <button
                    style={styles.discardButton}
                    title="Discard — won't be suggested again"
                    onClick={() => handleDiscardVehicle(selectedBrand, v.adg)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {(state.ignored_adgs || []).length > 0 && (
        <section style={styles.card}>
          <h2 style={styles.h2}>Ignored vehicles ({state.ignored_adgs.length})</h2>
          <p style={styles.meta}>
            Discarded ADGs — these won't be suggested again on future uploads. Restore one if it
            was discarded by mistake; it'll reappear next time you upload a sheet containing it.
          </p>
          <div style={styles.vehicleList}>
            {state.ignored_adgs.map((adg) => (
              <div key={adg} style={styles.vehicleRow}>
                <span style={styles.ignoredAdg}>ADG {adg}</span>
                <button style={styles.restoreButton} onClick={() => handleUnignore(adg)}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {selectedVehicle && (
        <VehicleEditor
          brand={selectedBrand}
          vehicle={selectedVehicle}
          brandConfirmed={(state.confirmed_brands || []).includes(selectedBrand)}
          componentCategories={state.componentCategories}
          onSaved={() => {
            setSelectedVehicle(null);
            loadState();
          }}
        />
      )}

      <section style={styles.card}>
        <h2 style={styles.h2}>3. Publish</h2>
        <p>
          Publishing pushes everything currently categorized (this brand's live vehicle list,
          exclusion tables, no-clutch flags, and ADG overrides) to the tools BMs use. Anything
          still sitting in the pending queue above is not affected.
        </p>
        <button style={styles.button} onClick={handlePublish}>Publish changes</button>
        {publishMsg && <p style={styles.msg}>{publishMsg}</p>}
      </section>
    </div>
  );
}

function VehicleEditor({ brand, vehicle, brandConfirmed, componentCategories, onSaved }) {
  const [mode, setMode] = useState(brandConfirmed ? 'inherit' : 'brand');
  const [selectedComponents, setSelectedComponents] = useState({});
  const [noClutch, setNoClutch] = useState(false);
  const [overrideMonths, setOverrideMonths] = useState('');
  const [overrideKm, setOverrideKm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  function toggleComponent(name) {
    setSelectedComponents((prev) => ({
      ...prev,
      [name]: prev[name] ? undefined : { months: '', km: '' },
    }));
  }

  function updateComponentField(name, field, value) {
    setSelectedComponents((prev) => ({
      ...prev,
      [name]: { ...prev[name], [field]: value },
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    const body = { brand, adg: vehicle.adg, noClutch };

    if (mode === 'brand') {
      const components = Object.entries(selectedComponents)
        .filter(([, v]) => v)
        .map(([component, v]) => ({ component, months: v.months, km: v.km }));
      if (components.length === 0) {
        setError('Select at least one component.');
        setSaving(false);
        return;
      }
      body.exclusionMode = 'brand';
      body.components = components;
    } else if (mode === 'adg_override') {
      body.exclusionMode = 'adg_override';
      body.overridePeriod = { months: overrideMonths, km: overrideKm };
    } else {
      body.exclusionMode = 'inherit';
    }

    const res = await fetch('/api/admin/vehicle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    setSaving(false);
    if (!res.ok) {
      setError(result.error || 'Save failed.');
      return;
    }
    onSaved();
  }

  return (
    <section style={styles.card}>
      <h2 style={styles.h2}>Categorize: {vehicle.desc || vehicle.adg}</h2>
      <p style={styles.meta}>
        ADG {vehicle.adg} · Warranty: {vehicle.warranty || '—'}
      </p>

      <div style={styles.modeRow}>
        {brandConfirmed && (
          <label style={styles.radioLabel}>
            <input
              type="radio"
              checked={mode === 'inherit'}
              onChange={() => setMode('inherit')}
            />
            {' '}Standard — inherit {brand}'s existing exclusion table
          </label>
        )}
        <label style={styles.radioLabel}>
          <input
            type="radio"
            checked={mode === 'brand'}
            onChange={() => setMode('brand')}
          />
          {' '}{brandConfirmed ? `Rebuild ${brand}'s exclusion table` : `Build exclusion table for new brand ${brand}`}
        </label>
        {brandConfirmed && (
          <label style={styles.radioLabel}>
            <input
              type="radio"
              checked={mode === 'adg_override'}
              onChange={() => setMode('adg_override')}
            />
            {' '}This vehicle is an exception — override drop-off period for this ADG only
          </label>
        )}
      </div>

      {mode === 'brand' && (
        <div>
          <p style={styles.sectionLabel}>Select applicable drop-off components:</p>
          <div style={styles.checkGrid}>
            {componentCategories.map((c) => (
              <label key={c} style={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={!!selectedComponents[c]}
                  onChange={() => toggleComponent(c)}
                />
                {' '}{c}
              </label>
            ))}
          </div>

          {Object.entries(selectedComponents)
            .filter(([, v]) => v)
            .map(([name, v]) => (
              <div key={name} style={styles.dropoffRow}>
                <span style={styles.dropoffName}>{name}</span>
                <input
                  type="number"
                  placeholder="months"
                  value={v.months}
                  onChange={(e) => updateComponentField(name, 'months', e.target.value)}
                  style={styles.smallInput}
                />
                <input
                  type="number"
                  placeholder="km"
                  value={v.km}
                  onChange={(e) => updateComponentField(name, 'km', e.target.value)}
                  style={styles.smallInput}
                />
              </div>
            ))}
        </div>
      )}

      {mode === 'adg_override' && (
        <div style={styles.dropoffRow}>
          <span style={styles.dropoffName}>Override period for this ADG</span>
          <input
            type="number"
            placeholder="years"
            value={overrideMonths}
            onChange={(e) => setOverrideMonths(e.target.value)}
            style={styles.smallInput}
          />
          <input
            type="number"
            placeholder="km"
            value={overrideKm}
            onChange={(e) => setOverrideKm(e.target.value)}
            style={styles.smallInput}
          />
        </div>
      )}

      <label style={styles.radioLabel}>
        <input type="checkbox" checked={noClutch} onChange={(e) => setNoClutch(e.target.checked)} />
        {' '}This is a DHT / CVT / automatic — suppress the clutch exclusion row
      </label>

      {error && <p style={styles.error}>{error}</p>}
      <button style={styles.button} onClick={handleSave} disabled={saving}>
        {saving ? 'Saving...' : 'Save and move to live dataset'}
      </button>
    </section>
  );
}

const styles = {
  page: { fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: 24, color: '#1a1a2e' },
  h1: { fontSize: 24, marginBottom: 16 },
  h2: { fontSize: 18, marginBottom: 12 },
  card: { border: '1px solid #d9e4f0', borderRadius: 8, padding: 20, marginBottom: 20, background: '#fff' },
  loginBox: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 320, margin: '80px auto' },
  input: { padding: 10, border: '1px solid #ccc', borderRadius: 6, fontSize: 14 },
  button: { padding: '10px 16px', background: '#0a2e5c', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  error: { color: '#d64045', fontSize: 13 },
  msg: { fontSize: 13, color: '#00a878', marginTop: 8 },
  brandGrid: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  brandButton: { padding: '8px 14px', border: '1px solid #d9e4f0', borderRadius: 6, background: '#f4f7fb', cursor: 'pointer', fontSize: 13 },
  brandButtonActive: { background: '#0a2e5c', color: '#fff' },
  vehicleList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 },
  vehicleRow: { display: 'flex', alignItems: 'center', gap: 8 },
  vehicleButton: { flex: 1, textAlign: 'left', padding: '8px 12px', border: '1px solid #eee', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 },
  vehicleButtonActive: { borderColor: '#0a2e5c', background: '#e8f0fe' },
  discardButton: { padding: '6px 10px', border: '1px solid #f0d0d2', borderRadius: 6, background: '#fff5f5', color: '#d64045', cursor: 'pointer', fontSize: 13 },
  brandActionRow: { marginTop: 12, marginBottom: 4 },
  discardAllButton: { padding: '6px 12px', border: '1px solid #f0d0d2', borderRadius: 6, background: '#fff5f5', color: '#d64045', cursor: 'pointer', fontSize: 12 },
  ignoredAdg: { flex: 1, fontSize: 13, color: '#6b7c93' },
  restoreButton: { padding: '6px 12px', border: '1px solid #d9e4f0', borderRadius: 6, background: '#f4f7fb', cursor: 'pointer', fontSize: 12 },
  meta: { fontSize: 13, color: '#6b7c93', marginBottom: 12 },
  modeRow: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  radioLabel: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 },
  sectionLabel: { fontSize: 13, fontWeight: 600, marginBottom: 8 },
  checkGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 },
  checkLabel: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 },
  dropoffRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  dropoffName: { fontSize: 13, width: 240 },
  smallInput: { width: 80, padding: 6, border: '1px solid #ccc', borderRadius: 4, fontSize: 13 },
};
