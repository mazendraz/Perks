import { templateCategory, type CardTemplate } from '../../contracts/src/branding.js';
export function CardArtwork({ template }: { template: CardTemplate }) {
  const category = templateCategory(template);
  return (
    <div className={'card-art art-' + category} aria-hidden="true">
      <svg viewBox="0 0 600 420" fill="none">
        {category === 'cafe' ? (
          <>
            <ellipse cx="485" cy="270" rx="100" ry="132" transform="rotate(32 485 270)" />
            <path d="M440 158c100 85-3 137 90 223M394 122c-18-52 48-58 27-109M438 112c-18-52 48-58 27-109M-30 380C110 260 205 460 400 378M-30 397C110 277 205 477 400 395" />
            <circle cx="490" cy="270" r="165" strokeDasharray="2 10" />
          </>
        ) : category === 'restaurant' ? (
          <>
            <circle cx="480" cy="255" r="164" />
            <circle cx="480" cy="255" r="141" />
            <circle cx="480" cy="255" r="121" strokeDasharray="1 9" />
            <path d="M265 75v100m18-100v100m18-100v100m-36-38h36m-36 38q18 35 36 0m-18 20v150M578 68c-24 50-30 98-30 131h30m0-131v285M-20 367h330M-20 380h330" />
          </>
        ) : category === 'barber' ? (
          <>
            <path d="M392-10v440m24-440v440M392 12l24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24m-24 77 24-24M472 195l115 135m-115-30L587 145" />
            <circle cx="457" cy="176" r="29" />
            <circle cx="457" cy="313" r="29" />
            <path d="M35 382h285M35 391h285" />
          </>
        ) : (
          <>
            <circle cx="510" cy="66" r="154" />
            <circle cx="510" cy="66" r="130" />
            <circle cx="510" cy="66" r="106" />
            <path d="M-80 315C125 60 280 505 700 150M-80 340C125 85 280 530 700 175" />
          </>
        )}
      </svg>
    </div>
  );
}
