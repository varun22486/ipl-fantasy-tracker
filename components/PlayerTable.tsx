import { FantasyPlayer, playerPoints } from "@/lib/scoring";

type Props = {
  title: string;
  players: FantasyPlayer[];
};

export default function PlayerTable({ title, players }: Props) {
  return (
    <div style={{
      border: "1px solid #e2e8f0",
      borderRadius: 20,
      background: "white",
      padding: 20,
      boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
    }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Player", "Captain", "Runs", "Wkts", "Ct", "50", "100", "3W", "5W", "MoM", "Points"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #e2e8f0", fontSize: 13, color: "#475569" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {players.map((p) => (
              <tr key={p.name}>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.name}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.captain ? "★" : "-"}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.runs}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.wickets}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.catches}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.fifty_bonus}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.hundred_bonus}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.three_w_bonus}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.five_w_bonus}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9" }}>{p.mom_bonus}</td>
                <td style={{ padding: 10, borderBottom: "1px solid #f1f5f9", fontWeight: 700 }}>{playerPoints(p).final}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
