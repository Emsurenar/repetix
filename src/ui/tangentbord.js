// Hur mycket av skärmen tangentbordet tar.
//
// Dialogerna är bottenark på telefon: de sitter fast i skärmens underkant och
// är som högst 88dvh. Men dvh räknar inte tangentbordet — den dynamiska
// enheten följer webbläsarens egna fält som adressraden, inte ett tangentbord
// som lagts över sidan. Arket blev därför kvar under tangentbordet, och fältet
// man just tryckt på hamnade bakom det. Att sidan dessutom hoppade berodde på
// samma sak från andra hållet: webbläsaren rullade fram fältet på egen hand,
// eftersom ingen annan gjorde det.
//
// visualViewport är det enda som vet. Skillnaden mellan layoutens höjd och den
// synliga ytan ÄR tangentbordet, och den skrivs ut som en variabel som
// stilmallen kan räkna med.

/** Publiceras på :root. Noll när inget tangentbord är uppe. */
const VARIABEL = '--tangentbord';

/* Under det här är skillnaden inte ett tangentbord utan en adressrad som
 * glider undan. Att flytta arket för den hade gjort varje rullning till en
 * rörelse i dialogen. */
const MINSTA_TANGENTBORD = 120;

export function initTangentbord() {
  const vv = window.visualViewport;
  if (!vv) return;

  /* Skriv bara när måttet faktiskt ändrats.
   *
   * scroll-händelsen kommer för varje bildruta man rullar, och att sätta en
   * variabel på :root räknar om stilen för hela dokumentet varje gång. Med
   * tangentbordet uppe var det en omräkning per bildruta för ett värde som stod
   * still — rullningen blev ryckig av arbetet med att beskriva att ingenting
   * hade hänt. */
  let senast = null;

  const skriv = () => {
    const skymt = window.innerHeight - (vv.height + vv.offsetTop);
    const tangentbord = skymt > MINSTA_TANGENTBORD ? Math.round(skymt) : 0;
    if (tangentbord === senast) return;
    senast = tangentbord;
    document.documentElement.style.setProperty(VARIABEL, `${tangentbord}px`);
  };

  vv.addEventListener('resize', skriv);
  vv.addEventListener('scroll', skriv);
  skriv();
}
