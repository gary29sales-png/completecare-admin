export default function Home() {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 40 }}>
      <p>
        This is the Complete Care admin backend. Go to <a href="/admin">/admin</a> to manage
        vehicle data, or fetch <a href="/api/vehicles">/api/vehicles</a> for the published dataset
        the BM tools consume.
      </p>
    </div>
  );
}
