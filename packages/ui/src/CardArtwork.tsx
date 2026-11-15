import {
  logoMarkBox,
  templateCategory,
  type CardTemplate,
  type LogoMarkPosition,
} from '../../contracts/src/branding.js';
import { cardArtMarkup } from '../../domain/src/card-art.js';
/** The edition's drawing behind the card. The "Your logo" edition shows the shop logo instead. */
export function CardArtwork({
  template,
  logo,
  position,
  bleed,
}: {
  template: CardTemplate;
  logo?: string;
  position?: LogoMarkPosition;
  bleed?: number;
}) {
  const category = templateCategory(template);
  if (template === 'logomark') {
    // Same box as the Wallet artwork, in percent of the 600×420 card.
    const box = logoMarkBox(600, 420, position, bleed ?? 0);
    return (
      <div className={'card-art art-' + category} aria-hidden="true">
        {logo && (
          <img
            className="card-art-logo"
            src={logo}
            alt=""
            style={{
              left: (box.x / 600) * 100 + '%',
              top: (box.y / 420) * 100 + '%',
              width: (box.size / 600) * 100 + '%',
              height: (box.size / 420) * 100 + '%',
            }}
          />
        )}
      </div>
    );
  }
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
