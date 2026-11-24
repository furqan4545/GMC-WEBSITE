function ArticleGrid({ articles }) {
  return (
    <ul className="gmc-related-grid">
      {articles.map(({ href, title, image }) => (
        <li key={href}>
          <a className="gmc-related-card" href={href}>
            {image && (
              <span className="gmc-related-photo">
                <img src={image} alt="" loading="lazy" decoding="async" />
              </span>
            )}
            <span className="gmc-related-title">{title}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function ArticleRecommendations({ title, articles }) {
  const Section = title ? 'section' : 'div';
  const classes = ['gmc-related'];
  if (!title) classes.push('gmc-related-inline');
  if (articles.length === 1) classes.push('gmc-related-single');
  return (
    <Section className={classes.join(' ')} aria-label={title || undefined}>
      <div className="gmc-related-inner">
        {title && <h2>{title}</h2>}
        <ArticleGrid articles={articles} />
      </div>
    </Section>
  );
}
