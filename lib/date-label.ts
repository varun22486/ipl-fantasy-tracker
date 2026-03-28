export function getMatchLabel(date: string, existingCountForDate: number) {
  return existingCountForDate <= 0 ? date : `${date}_${existingCountForDate + 1}`;
}
