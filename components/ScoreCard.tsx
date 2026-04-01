type Props = {
  label: string;
  value: string | number;
};

export default function ScoreCard({ label, value }: Props) {
  return (
    <div className="score-stat-card">
      <div className="score-stat-card__label">{label}</div>
      <div className="score-stat-card__value">{value}</div>
    </div>
  );
}
