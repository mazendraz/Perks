import { templateCategory, type CardTemplate } from '../../contracts/src/branding.js';
import { cardArtMarkup } from '../../domain/src/card-art.js';
export function CardArtwork({ template }: { template: CardTemplate }) {
  const category = templateCategory(template);
  return (
    <div className={'card-art art-' + category} aria-hidden="true">
      <svg
        viewBox="0 0 600 420"
        fill="none"
        dangerouslySetInnerHTML={{ __html: cardArtMarkup[category] }}
      />
    </div>
  );
}
