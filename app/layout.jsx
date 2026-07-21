export const metadata = {
  title: 'Complete Care Admin',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f4f7fb' }}>{children}</body>
    </html>
  );
}
