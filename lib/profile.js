// The bot's public profile in Telegram: name, the short "about" line, the description shown in an empty chat
// before the user taps Start, and the "/" command menu. bot.js sets all of these through the Bot API
// (setMyName, setMyShortDescription, setMyDescription, setMyCommands) once per PROFILE_VERSION, so BotFather
// is needed only for the username and the profile picture (BOTFATHER.md).
// "default" is shown to every Telegram language without its own entry; "he" to Hebrew Telegram apps.
// Telegram limits: name 64, short description 120, description 512, command description 256 characters.
const PROFILE_VERSION = 2;

const PROFILE = {
  default: {
    name: 'Flight Price Alerts ✈️',
    short: 'Free flight price alerts. Pick a route, dates and a price limit, and get a message when a ticket drops below it.',
    description: [
      'I watch flight prices for you, for free.',
      '',
      '1. Tap Start and open the form (1 minute): route, dates (flexible or a range), passengers, bags, stops, price limit.',
      '2. I search several sites a few times a day.',
      '3. You get an alert when a matching ticket is under your limit, and a short daily summary.',
      '',
      'No account, no ads. Your details are stored encrypted, and /stop deletes them.',
    ].join('\n'),
    commands: [['start', 'Start or sign up'], ['status', 'My settings and the best price'], ['edit', 'Edit my settings in the form'],
      ['price', 'New price limit, e.g. /price 900'], ['dest', 'New destination, e.g. /dest Athens'],
      ['out', 'Outbound date, e.g. /out 21.12 3'], ['back', 'Return date, e.g. /back 10.1 3'],
      ['lang', 'עברית'], ['help', 'Help'], ['stop', 'Stop and delete my details']],
  },
  he: {
    name: 'התראות מחירי טיסות ✈️',
    short: 'התראות חינם על מחירי טיסות. בוחרים מסלול, תאריכים וסף מחיר, ומקבלים הודעה כשכרטיס יורד מתחת לסף.',
    description: [
      'אני עוקב בשבילכם אחרי מחירי טיסות, בחינם.',
      '',
      '1. לוחצים Start ופותחים את הטופס (דקה): מסלול, תאריכים (גמישים או טווח), נוסעים, כבודה, עצירות וסף מחיר.',
      '2. אני מחפש בכמה אתרים כמה פעמים ביום.',
      '3. מקבלים התראה כשכרטיס מתאים יורד מתחת לסף, וסיכום קצר פעם ביום.',
      '',
      'בלי חשבון ובלי פרסומות. הפרטים נשמרים מוצפנים, ו-/stop מוחק אותם.',
    ].join('\n'),
    commands: [['start', 'התחלה או הרשמה'], ['status', 'ההגדרות שלי והמחיר הכי טוב'], ['edit', 'עריכת ההגדרות בטופס'],
      ['price', 'סף מחיר חדש, למשל /price 900'], ['dest', 'יעד חדש, למשל /dest אתונה'],
      ['out', 'תאריך הלוך, למשל /out 21.12 3'], ['back', 'תאריך חזור, למשל /back 10.1 3'],
      ['lang', 'English'], ['help', 'עזרה'], ['stop', 'הפסקה ומחיקת הפרטים']],
  },
};

module.exports = { PROFILE, PROFILE_VERSION };
