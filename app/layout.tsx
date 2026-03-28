export const metadata = {
  title: "IPL Fantasy Tracker",
  description: "You vs Rahul fantasy tracker"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "Inter, Arial, sans-serif", background: "#f8fafc" }}>
        {children}
      </body>
    </html>
  );
}
