export default function CharacterSheetSection({
  title,
  description,
  actions,
  children,
  className = '',
  id,
}) {
  return (
    <section className={`dnd-sheet-section ${className}`.trim()} id={id}>
      <header className="dnd-sheet-section__header">
        <div className="dnd-sheet-section__headings">
          <h2>{title}</h2>
          {description ? (
            <p className="dnd-sheet-section__description">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="dnd-sheet-section__actions">{actions}</div> : null}
      </header>
      <div className="dnd-sheet-section__body">{children}</div>
    </section>
  );
}
