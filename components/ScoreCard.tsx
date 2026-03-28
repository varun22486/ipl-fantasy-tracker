type Props = {
  label: string;
  value: string | number;
};

export default function ScoreCard({ label, value }: Props) {
  return (
    <div style={{
      border: "1px solid #e2e8f0",
      borderRadius: 20,
      background: "white",
      padding: 20,
      boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
    }}>
      <div style={{ fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>{value}</div>
    </div>
  );
}
