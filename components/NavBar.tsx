/**
 * Page title block (primary navigation lives in AppShell sidebar).
 */
export default function NavBar({ title, subtitle }: { title?: string; subtitle?: string }) {
  return (
    <header className="page-header">
      <p className="page-header__eyebrow">IPL Fantasy Tracker</p>
      {title && <h1 className="page-header__title">{title}</h1>}
      {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
    </header>
  );
}
