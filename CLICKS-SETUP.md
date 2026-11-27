# מעקב לחיצות על קישורים (Cloudflare Worker)

כל קישור בהודעות החיפוש (Kayak, Kiwi, Google, אתרי החברות) עובר דרך Worker קטן ב-Cloudflare. ה-Worker סופר את
הלחיצה ומעביר מיד לקישור המקורי, כך שהמשתמש לא מרגיש הבדל. הבוט (שרץ כל 5 דקות) קורא את הספירות ושומר אותן
ב-`logs/clicks.csv`, והן מופיעות גם ב-`/errors`.

**מה נשמר:** תאריך, המזהה האקראי של המשתמש (למשל `u3a3b26b74b`), האתר (`kayak` / `kiwi` / `google` / `airline` / `other`)
וסוג ההודעה (`alert` / `summary` / ...), ומספר הלחיצות. **לא** נשמרים קישורים, מסלולים, תאריכי טיסה, כתובות IP או שמות.
ב-Cloudflare הספירות נמחקות אחרי 90 יום; בקובץ ב-repo הן נשארות.

**עלות:** חינם, בלי כרטיס אשראי. התוכנית החינמית מספיקה בהרבה: 100,000 בקשות ביום, 1,000 לחיצות ביום (כתיבות ל-KV),
ו-1,000 קריאות של הספירות ביום (הבוט קורא כ-288).

**עד שמסיימים את ההתקנה** הכל עובד כמו קודם: בלי שני ה-secrets ב-GitHub הקישורים נשלחים ישירות, בלי מעקב.

## התקנה (כ-10 דקות, הכל בדפדפן)

1. **חשבון:** נרשמים ב-[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) עם אימייל וסיסמה, ומאשרים את המייל.
   לא צריך דומיין ולא כרטיס אשראי.
2. **מאגר לספירות (KV):** בתפריט בצד: **Storage & Databases → Workers KV → Create instance** (או Create namespace).
   שם: `flight-clicks` → Create.
3. **ה-Worker:** **Compute (Workers) → Workers & Pages → Create → Create Worker** (התבנית Hello World). שם: `flight-clicks` → **Deploy**.
   אחר כך **Edit code**, מוחקים את כל מה שיש בעורך, מדביקים את כל התוכן של [`cloudflare/worker.js`](cloudflare/worker.js) → **Deploy**.
4. **חיבור המאגר:** בדף של ה-Worker: **Bindings → Add binding → KV namespace**.
   Variable name: `CLICKS` (באותיות גדולות, בדיוק כך), KV namespace: `flight-clicks` → Add binding.
5. **סיסמה משותפת:** בדף של ה-Worker: **Settings → Variables and Secrets → Add**. Type: **Secret**, Name: `SECRET`,
   Value: מחרוזת אקראית ארוכה (למשל 30 אותיות ומספרים מתוך מחולל סיסמאות). שומרים אותה בצד לשלב 7 → Deploy.
6. **הכתובת:** בדף של ה-Worker מופיעה הכתובת שלו, למשל `https://flight-clicks.<השם-שלך>.workers.dev`.
   פתיחה שלה בדפדפן עם `/c` בסוף צריכה להציג `bad link`: זה אומר שה-Worker עובד (ומסרב לקישור לא חתום).
7. **GitHub:** ב-repo: **Settings → Secrets and variables → Actions → New repository secret**, פעמיים:
   - `CLICK_URL` = הכתובת משלב 6 (בלי `/` בסוף, בלי `/c`)
   - `CLICK_SECRET` = אותה מחרוזת משלב 5

## בדיקה

1. ב-Actions מריצים את **flight-watch** עם `mode: force-summary` ו-`user: admins` (רק האדמין מקבל הודעה).
2. בהודעה שמגיעה בטלגרם, הקישורים מתחילים בכתובת של ה-Worker. לוחצים על אחד: האתר אמור להיפתח כרגיל.
3. אחרי ההרצה הבאה של הבוט (עד 5 דקות) נוצר `logs/clicks.csv`, ו-`/errors` בבוט מציג שורה "🔗 לחיצות על קישורים".

## הערות

- קישורים בהודעות שנשלחו לפני ההתקנה לא נספרים; רק הודעות חדשות.
- כל קישור חתום (HMAC עם ה-`SECRET`), ולכן אי אפשר להשתמש ב-Worker כדי להפנות לאתרים אחרים.
- כמו בכל אתר, Cloudflare רואה את כתובת ה-IP של מי שלוחץ, אבל ה-Worker לא שומר אותה.
- החלפת הסיסמה: משנים את `SECRET` ב-Cloudflare ואת `CLICK_SECRET` ב-GitHub לאותו ערך. קישורים בהודעות ישנות יפסיקו לעבוד (`bad link`).
- כיבוי: מוחקים את `CLICK_URL` מה-secrets ב-GitHub, והקישורים חוזרים להישלח ישירות.
